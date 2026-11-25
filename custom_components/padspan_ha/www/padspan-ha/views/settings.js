// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Settings — user-configurable preferences
 *
 * Tabs (advanced mode):
 *   Appearance   — room colors, floor names, dark theme options
 *   Scanner Map  — assign scanners to rooms, per-map calibration clear
 *   Presence     — BLE tuning (ref power, path-loss, Kalman),
 *                  adaptive learning toggle, positioning algorithm
 *   Manage       — entity types toggle, MQTT, IRK devices
 *
 * Basic mode shows only the Appearance tab (no tabs UI).
 *
 * Uses a "draft" copy of the model so edits don't take effect until Save.
 */
const { BUY_URL, proPrice, PRO_PASS_PRICE, proLifetimeWords, proLifetimeOpen, brightProOpen, BRIGHT_PRICE, BRIGHT_UPGRADE_PRICE, EDITIONS_URL,
        tierAtLeast, currentTier, IDEAS_URL, IDEAS_NEW_URL, IDEAS_MAIL, surfacesForEdition } =
  await import(`./editions.js${new URL(import.meta.url).search}`);
// 📺 Wall screens (views/wall_card.js). Optional: a card that fails to load
// leaves the rest of Settings as it is.
const WALLCARD = await import(`./wall_card.js${new URL(import.meta.url).search}`).catch(() => null);
// 📣 Open screens (screens.py): list, reload, announce. Off by default.
const SCREENSCARD = await import(`./screens_card.js${new URL(import.meta.url).search}`).catch(() => null);
// Basic's focused views: a link opens one card of a tab (views/focus.js).
const FOCUS = await import(`./focus.js${new URL(import.meta.url).search}`);
// Optional: why Build from plans isn't offered, in the rooms helper's words (Settings → AI).
const AIWO = await import(`./ai_wizard_offer.js${new URL(import.meta.url).search}`).catch(() => null);
// Optional too: the tester sign-up must not take the Settings tab with it.
// Copy that works on plain http too (Home Assistant often is): the voice card's sentences.
const { copyText } = await import(`./device_name.js${new URL(import.meta.url).search}`);
const { testerSection } = await import(`./tester_signup.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: tester_signup failed to load", err); return { testerSection: () => null }; });
// Optional: a card that fails to load must not take the Settings tab with it.
const { trialOfferFromCtx, newTabOk } = await import(`./trial_offer.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: trial_offer failed to load", err); return { trialOfferFromCtx: () => null, newTabOk: () => true }; });
// Optional: free Pro by invite or by testing (pro_invite.js).
const PRO = await import(`./pro_invite.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: pro_invite failed to load", err);
    return { inviteCard: () => null, inviteHostFromCtx: () => null, testerCardBodyShort: () => "", testerOfferOn: () => false }; });
// Optional as well: only the Atlas weather section's "Automatic — …" labels
// and warning list need it.
const WX = await import(`./atlas_weather.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: atlas_weather failed to load", err); return null; });
// The same Zigbee device in ZHA and Zigbee2MQTT (views/zigbee_twins.js): the Atlas
// weather pickers leave the duplicate copy out. Optional, as the others are.
const TW = await import(`./zigbee_twins.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: zigbee_twins failed to load", err); return null; });
// Settings → Atlas → Power teams (views/power_teams.js). Optional, as the others are.
const POWER_TEAMS = await import(`./power_teams.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: power_teams failed to load", err); return null; });
// Settings → Tracking → Home Assistant and integrations → Lights follow people (views/lights_follow.js). Optional too.
const LIGHTS_FOLLOW = await import(`./lights_follow.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: lights_follow failed to load", err); return null; });

// Its words in the panel's language (views/i18n.js; English is the key). So far the frame, Appearance, Scanner Map
// and Tracking; the other tabs are still English.
const { t, tn } = await import(`./i18n.js${new URL(import.meta.url).search}`);

export function render(ctx){
  const { el, esc, roomColor, helpBtn } = ctx.helpers;
  const isBasic = ctx.state.complexity === "basic";
  const root = el("section",{id:"settings"});
  root.className = ctx.state.view==="settings" ? "" : "hidden";

  // Draft model — local copy so edits don't affect live state until Save
  if(!ctx.state._settingsDraft || ctx.state._settingsDraftBuild !== ctx.state.buildId){
    ctx.state._settingsDraft = JSON.parse(JSON.stringify(ctx.state.model || {floors:[], room_meta:{}}));
    if(!ctx.state._settingsDraft.floors || !ctx.state._settingsDraft.floors.length) ctx.state._settingsDraft.floors = [{id:"main", name:"Main"}];
    if(!ctx.state._settingsDraft.floors.find(f=>f.id==="main")) ctx.state._settingsDraft.floors.unshift({id:"main", name:"Main"});
    ctx.state._settingsDraftBuild = ctx.state.buildId;
  }
  const draft = ctx.state._settingsDraft;
  const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const haAreas  = (ctx.state.model && Array.isArray(ctx.state.model.areas))  ? ctx.state.model.areas  : [];

  // One tab's content, for the tab bar below and for a link's tab in Basic.
  const _tabBody = (id) =>
    id === "appearance" ? _settingsAppearance(ctx, el, helpBtn, draft, haFloors, haAreas, roomColor, false) :
    id === "presence" ? _settingsPresence(ctx, el) :
    id === "features" ? _settingsFeatures(ctx, el) :
    id === "ai" ? _settingsAI(ctx, el) :
    id === "atlas" ? _settingsAtlas(ctx, el) :
    id === "ui" ? _settingsUI(ctx, el) :
    _scannerMap(ctx, el, haFloors);

  // Basic mode: no tabs, just appearance. A link from something Basic asks
  // for (the usage report, a guest tag, the licence, a Live Aboard setting)
  // opens just that card (state._focus, views/focus.js) with one way back:
  // nothing else of its tab, and the mode stays Basic.
  if(isBasic){
    const f = FOCUS.focusFor(ctx.state, "settings");
    if(f){
      root.appendChild(FOCUS.focusBar(ctx, f));
      const part = FOCUS.pickPart(_tabBody(f.tab), f.part);
      root.appendChild(!part ? el("div",{class:"card muted","data-focus-missing":f.part},t("This isn't available on this install."))
        : part.classList.contains("card") ? part : el("div",{class:"card"},[part]));
      return root;
    }
    root.appendChild(_settingsAppearance(ctx, el, helpBtn, draft, haFloors, haAreas, roomColor, true));
    root.appendChild(el("div",{class:"card",style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px"},[
      el("span",{class:"muted"},t("The usage report and guest tags have their own settings.")),
      el("button",{class:"btn inline","data-settings-open":"usage_report",onclick:()=>FOCUS.openFocus(ctx, PART.usageReport)},t("Usage report →")),
      el("button",{class:"btn inline","data-settings-open":"guest_tags",onclick:()=>FOCUS.openFocus(ctx, PART.guestTags)},t("Guest tags →")),
    ]));
    return root;
  }

  // Advanced / Development mode: tabbed — Appearance | Scanner Map | Tracking (id "presence") | Features | AI | Atlas | UI Structure.
  // The Atlas and Live Aboard settings were under UI Structure until 2026-10-30; "ui" still opens UI Structure, which links to Atlas.
  if(!ctx.state._settingsTab) ctx.state._settingsTab = "appearance";
  const activeTab = ctx.state._settingsTab;
  const setTab = (t) => { ctx.state._settingsTab = t; ctx.actions.renderRooms(); };

  // Tab definitions with help descriptions
  const _tabDefs = [
    ["appearance", t("Appearance"),
      t("How PadSpan looks: room colours that carry across the Overview map, the Follow tracker and every other drawing, Panel Style (Classic or 2025), Theme (with Follow the sun) and 2D Map Mode. Floors and rooms come from Home Assistant (HA Settings → Areas, labels & zones).")],
    ["scannermap", t("Scanner Map"),
      t("Shows where PadSpan thinks each of your Bluetooth scanners is physically located on the floor plan. The numbered dots are estimated positions based on your calibration data — when you collected fingerprints at known spots, each scanner recorded signal strength. Louder signal = scanner is closer to that spot. PadSpan combines all these readings to triangulate where the scanner must be sitting. The percentage is confidence (more calibration points = more accurate). If a dot is in the wrong place, collect more calibration points near that scanner to fix it. This tab also has Replace Scanner (swap calibration data when hardware is replaced) and Relearn Radio (adjust readings after antenna upgrade/downgrade).")],
    ["presence", t("Tracking"),
      t("How PadSpan decides which room a device is in and when it's away, in eight sections: rooms and timing, phones and guest tags, what the panel shows, positioning and calibration, receivers, performance, Home Assistant and integrations, and privacy. Each section's heading has a ? that explains it.")],
    ["features", t("Features"),
      t("Your PadSpan licence (edition, tier and key), then the experimental switches: Walk-to-Identify, Radio Map, Signal distortion map, RoomPlan and robot vacuum import, the phone setup helpers, MAC Rotation Bridging, Apple Device Classification and RSSI Vector Capture. The Forensics card is at the bottom.")],
    ["ai", t("AI"),
      t("AI power features: PadSpan can use an AI you have set up in Home Assistant (an AI Task) to read furniture photos and the stairs on your floor plans, with an optional backup AI Task. Nothing here runs unless you pick an AI Task. A cloud AI sends what it reads out of the house; a local one (like Ollama) keeps it home.")],
    ["atlas", t("Atlas"),
      t("The Atlas, PadSpan's house map for everyday light control, and Live Aboard, its 3D view: whether the Atlas is in the Home Assistant sidebar, what it draws, its outdoor weather, wall screens, and the Atlas as your Overview.")],
    ["ui", t("UI Structure"),
      t("Every tab is in the sidebar in every mode; the ones not in the main list are under More tools. Tick a tab here to move it into the main list in Advanced and Development mode (Basic keeps its short list). For example, tick Devices and Bluetooth for installers. The Edition & tier card shows which download this is and the tier its licence gives.")],
  ];

  const tabBar = el("div",{class:"tabs", style:"margin-bottom:14px;flex-wrap:wrap;gap:4px;align-items:center"});
  for(const [id, label, helpText] of _tabDefs){
    const tabWrap = el("div",{style:"display:inline-flex;align-items:center;gap:0"});
    tabWrap.appendChild(el("button",{
      class:"tab" + (activeTab===id ? " active" : ""),
      onclick:()=>setTab(id),
    }, label));
    // Help ? button
    const helpDot = el("button",{style:
      "width:16px;height:16px;border-radius:50%;border:1px solid #2d4a38;background:transparent;" +
      "color:#64748b;font-size:10px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;" +
      "justify-content:center;margin-left:2px;transition:color .15s,border-color .15s;flex-shrink:0"}, "?");
    helpDot.title = helpText;
    helpDot.addEventListener("mouseenter",()=>{helpDot.style.color="#52b788";helpDot.style.borderColor="#52b788";});
    helpDot.addEventListener("mouseleave",()=>{helpDot.style.color="#64748b";helpDot.style.borderColor="#2d4a38";});
    helpDot.addEventListener("click",(e)=>{
      e.stopPropagation();
      // Show as a modal for full readability
      const body = el("div",{style:"max-width:460px"},[
        el("div",{style:"font-weight:700;font-size:14px;color:#52b788;margin-bottom:8px"}, label),
        el("div",{style:"font-size:13px;color:#cbd5e1;line-height:1.6"}, helpText),
      ]);
      ctx.actions.openModal(t("Settings: {label}", { label }), body, t("Help"));
    });
    tabWrap.appendChild(helpDot);
    tabBar.appendChild(tabWrap);
  }
  root.appendChild(tabBar);

  root.appendChild(_tabBody(activeTab));
  // A link that named a card (?part=, Live Aboard's ⋯ list): scrolled to once, on this draw.
  const wantPart = ctx.state._settingsPart;
  if (wantPart) {
    ctx.state._settingsPart = null;
    const n = FOCUS.pickPart(root, wantPart);
    if (n) setTimeout(() => { try { n.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (_) { /* gone */ } }, 80);
  }
  return root;
}

// The cards a link opens on their own in Basic (views/focus.js PARTS) are
// marked data-focus-part where they are built.
const PART = FOCUS.PARTS;

// ── Appearance tab ─────────────────────────────────────────────────────────────
function _settingsAppearance(ctx, el, helpBtn, draft, haFloors, haAreas, roomColor, isBasic){
  const wrap = el("div",{});

  // Floors card (hidden in basic)
  if(!isBasic){
    const floorsCard = el("div",{class:"card"});
    floorsCard.appendChild(el("div",{style:"font-weight:700"},t("Floors")));
    floorsCard.appendChild(el("div",{class:"muted", style:"font-size:12px;margin-top:4px"},
      t("Floors are read from HA. Manage them in HA Settings → Areas, labels & zones.")
    ));
    const floorPills = el("div",{style:"display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"});
    if(haFloors.length){
      for(const f of haFloors) floorPills.appendChild(el("span",{class:"pill"}, f.name || f.id));
    } else {
      floorPills.appendChild(el("span",{class:"muted", style:"font-size:12px"}, t("No floors found in HA.")));
    }
    floorsCard.appendChild(floorPills);
    wrap.appendChild(floorsCard);
  }

  // Rooms color card
  const roomsCard = el("div",{class:"card", style:"margin-top:12px"});
  roomsCard.appendChild(el("div",{class:"card-head"},[
    el("div",{style:"font-weight:700"}, isBasic ? t("Room colours") : t("Rooms")),
    el("div",{style:"display:flex;gap:6px;align-items:center"},[
      (!ctx.actions.canOpen || ctx.actions.canOpen("rooms")) ? el("button",{class:"btn inline", style:"font-size:11px;padding:2px 10px", "data-all-rooms":"settings", title:t("Every room's settings on one page"), onclick:()=>ctx.actions.openRooms()}, t("All rooms")) : null,
      helpBtn("settings_colors"),
    ]),
  ]));
  roomsCard.appendChild(el("div",{class:"muted", style:"font-size:12px;margin-top:6px"},
    isBasic
      ? t("Pick a colour for each room — this colour shows up on the Follow map and Overview.")
      : t("Assign each room to a floor and pick a color for sidebar + map overlays.")
  ));

  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const rooms = (() => {
    const disc = snap && snap.rooms_discovered;
    if (disc && disc.length) return [...disc].sort((a,b) => a.localeCompare(b));
    return Object.keys(ctx.state.roomTagMap||{}).sort((a,b) => a.localeCompare(b));
  })();

  const table = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:8px"});
  for(const room of rooms){
    if(!draft.room_meta) draft.room_meta = {};
    if(!draft.room_meta[room]) draft.room_meta[room] = { floor_id: "main", color: _toHex(roomColor(room)) };
    const meta = draft.room_meta[room];
    const haArea = haAreas.find(a => a.name === room);
    const haFloorId = haArea?.floor_id || "";
    if(haFloorId) meta.floor_id = haFloorId;
    const haFloor = haFloors.find(f => f.id === meta.floor_id);
    const floorLabel = haFloor ? (haFloor.name || haFloor.id) : (meta.floor_id || "—");

    // The floor and colour columns are 140px and 90px wherever there is room
    // (any row wider than 467px) and give way on a phone, where they used to
    // leave the name about 66px. The dot sits in a box one text line tall and
    // does not wrap away from the name, so it stays beside the name's first
    // line when the name runs to a second.
    const row = el("div",{style:"display:grid;grid-template-columns:1fr min(140px,30%) min(90px,20%);gap:10px;align-items:center;border:1px solid #1b3526;border-radius:12px;padding:10px;background:#0a150e"});
    row.appendChild(el("div",{style:"display:flex;align-items:flex-start;gap:10px"},[
      el("span",{style:"display:flex;align-items:center;flex:none"},[
        "\u200b",   // a zero-width space: gives the box the height of one line of text
        el("span",{class:"dot", style:`background:${meta.color || roomColor(room)};`}),
      ]),
      el("div",{style:"font-weight:600;min-width:0"}, room),
    ]));
    row.appendChild(el("div",{style:"display:flex;flex-direction:column;gap:2px"},[
      el("div",{class:"muted", style:"font-size:10px"}, t("Floor (HA)")),
      el("div",{style:"font-size:12px;font-weight:600;color:#94a3b8"}, floorLabel),
    ]));
    const col = document.createElement("input");
    col.type = "color";
    col.value = _toHex(meta.color || roomColor(room));
    col.addEventListener("input", ()=>{ meta.color = col.value; });
    row.appendChild(col);
    table.appendChild(row);
  }
  roomsCard.appendChild(table);
  wrap.appendChild(roomsCard);

  const saveCard = el("div",{class:"card", style:"margin-top:12px"});
  const saveBtn = el("button",{class:"btn primary", onclick:async()=>{
    await ctx.actions.modelUpdate({floors: draft.floors || [], room_meta: draft.room_meta || {}});
    alert(t("Saved ✔"));
  }}, t("Save floors & room settings"));
  saveCard.appendChild(el("div",{class:"muted"},t("These settings are stored locally in Home Assistant storage.")));
  saveCard.appendChild(el("div",{style:"margin-top:10px"}, saveBtn));
  wrap.appendChild(saveCard);

  // ── Panel Style (chrome skin) ─────────────────────────────────────────────
  {
    const settings = ctx.state.settings || {};
    const skinNow = settings.ui_skin === "2025" ? "2025" : "classic";
    const mkSkin = (val, label) => {
      const b = el("button",{class:"btn inline"+(skinNow===val?" on":"")}, label);
      b.addEventListener("click", async()=>{
        if (skinNow === val) return;
        try {
          await ctx.actions.settingsSet({ ui_skin: val });
          ctx.toast(val === "2025" ? t("2025 style on") : t("Classic style restored"));
        } catch(e){ ctx.toast(t("Failed to save"), true); }
      });
      return b;
    };
    wrap.appendChild(el("div",{class:"card",style:"border-color:" + (skinNow === "2025" ? "#52b788" : "#2d4a38")},[
      el("div",{class:"h2",style:"margin:0 0 4px;color:#52b788"}, t("Panel Style")),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        t("Classic is the original panel, unchanged. 2025 restyles the chrome only — grouped sidebar with icons, a 60px collapsed rail, underlined sub-tabs, flatter buttons and cards. It takes effect immediately and alters nothing but appearance, so switching back is this same control.")),
      el("div",{class:"row"},[ mkSkin("classic",t("Classic")), mkSkin("2025","2025") ]),
    ]));
  }

  // ── Theme: Night, Light (inverted) or Day ───────────────────────────────
  // Light is the accessibility inversion (settings.light_theme), kept as it
  // always was for anyone who needs it; Day is the designed light palette
  // (settings.day_theme, day_theme.js). One is on at a time.
  {
    const settings = ctx.state.settings || {};
    const PAL = ["graphite", "ocean", "dusk", "contrast"];   // day_theme.js PALETTES
    const PRO_LOOKS = ["graphite", "ocean", "dusk", "day"];   // PadSpan Pro; Night, Light and High contrast are everyone's
    const proOk = tierAtLeast(currentTier(settings), "pro");
    // PadSpan Bright never had these and its ladder doesn't sell PadSpan Pro:
    // there they are simply not shown, unless a Pro key unlocks them.
    const hideLocked = String(settings.edition || "").toLowerCase() === "bright" && !proOk;
    const now = proOk && settings.day_theme === true ? "day" : settings.light_theme === true ? "light"
      : PAL.includes(settings.theme_palette) && (proOk || !PRO_LOOKS.includes(settings.theme_palette)) ? settings.theme_palette : "night";
    const NAMES = { night: t("Night"), graphite: t("Graphite"), ocean: t("Ocean"), dusk: t("Dusk"), contrast: t("High contrast"), light: t("Light"), day: t("Day") };
    const mkTheme = (val, label) => {
      const locked = PRO_LOOKS.includes(val) && !proOk;
      if (locked && hideLocked) return null;
      const b = el("button",{class:"btn inline"+(now===val?" on":""), ...(locked ? { disabled:"", style:"opacity:.45;cursor:default",
        title:"PadSpan Pro: " + t("Settings → Features → PadSpan licence") } : {})}, label);
      b.addEventListener("click", async()=>{
        if (now === val || locked) return;
        try {
          const palette = PAL.includes(val) ? val : "";
          await ctx.actions.settingsSet({ light_theme: val === "light", day_theme: val === "day", theme_palette: palette });
          ctx.toast(t("{name} theme on", { name: NAMES[val] }));
        } catch(e){ ctx.toast(t("Failed to save"), true); }
      });
      return b;
    };
    // Follow the sun (panel.js _sunLook): Day while the sun is up (Light
    // without Pro), the Theme picked here once it sets. Off by default.
    const sunToggle = el("input",{type:"checkbox",id:"themeFollowSunToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    sunToggle.checked = settings.theme_follow_sun === true;
    sunToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ theme_follow_sun: sunToggle.checked });
        ctx.toast(sunToggle.checked ? t("Theme follows the sun") : t("Theme stays as picked"));
      } catch(e){ ctx.toast(t("Failed to save"), true); }
    });
    const hasSun = !!(ctx.hass && ctx.hass.states && ctx.hass.states["sun.sun"]);
    wrap.appendChild(el("div",{class:"card",style:"margin-top:12px;border-color:" + (now !== "night" ? "#52b788" : "#2d4a38")},[
      el("div",{class:"h2",style:"margin:0 0 4px;color:#52b788"}, t("Theme")),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        t("Night is PadSpan's dark forest green. Graphite, Ocean and Dusk are Night in charcoal, navy or plum. High contrast is black with white text and solid edges, for eyes that need it. Light inverts every colour in the panel (white becomes black, black becomes white) for anyone who can't use a dark screen; photos and map images are turned back so they still look normal. Day is the panel redrawn in light colours. Every one keeps the green accent and the colours that mean something (alarms, warnings, tracking), and maps, charts, the 3D house and Live Tracker keep their night colours. It takes effect immediately, in every browser. The sidebar Atlas page is the exception: it stays dark with every theme, and Light doesn't change it either, so Light won't help there if you can't use a dark screen.")),
      el("div",{class:"row",style:"flex-wrap:wrap"},[ mkTheme("night",t("Night")), mkTheme("graphite",t("Graphite")), mkTheme("ocean",t("Ocean")),
        mkTheme("dusk",t("Dusk")), mkTheme("contrast",t("High contrast")), mkTheme("light",t("Light (inverted)")), mkTheme("day",t("Day")) ].filter(Boolean)),
      ...(proOk || hideLocked ? [] : [el("div",{class:"muted",style:"font-size:12px;margin-top:8px"},
        t("Graphite, Ocean, Dusk and Day come with PadSpan Pro ({path}). Night, Light and High contrast are in every edition.", { path: t("Settings → Features → PadSpan licence") }))]),
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-top:12px"},[
        sunToggle,
        el("label",{for:"themeFollowSunToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"}, t("Follow the sun")),
      ]),
      el("div",{class:"muted",style:"font-size:12px;margin-top:4px"},
        (proOk ? t("Day from sunrise to sunset, then the theme picked above (Night if that is Day or Light). Goes by Home Assistant's Sun (sun.sun).")
          : t("Light (inverted) from sunrise to sunset, then the theme picked above (Night if that is Day or Light). Goes by Home Assistant's Sun (sun.sun).")) +
        (hasSun ? "" : " " + t("This Home Assistant doesn't have it (Settings → Devices & services → Sun), so the theme stays as picked."))),
    ]));
  }

  // ── Units: feet and inches (owner, 2026-11-12: "Mapping and the helper first"), off by default ──
  {
    const settings = ctx.state.settings || {};
    const feetToggle = el("input",{type:"checkbox",id:"unitsFeetToggle","data-units-feet":"toggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    feetToggle.checked = settings.units_feet === true;
    feetToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ units_feet: feetToggle.checked });
        ctx.toast(feetToggle.checked ? t("Lengths shown in feet and inches") : t("Lengths shown in metres"));
      } catch(e){ ctx.toast(t("Failed to save"), true); }
    });
    wrap.appendChild(el("div",{class:"card",style:"margin-top:12px","data-units-feet":"card"},[
      el("div",{class:"h2",style:"margin:0 0 4px;color:#52b788"}, t("Units")),
      el("div",{style:"display:flex;align-items:center;gap:8px"},[
        feetToggle,
        el("label",{for:"unitsFeetToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"}, t("Show lengths in feet and inches")),
      ]),
      el("div",{class:"muted",style:"font-size:12px;margin-top:4px"},
        t("Changes what is shown where you measure or check a floor plan in Mapping and in the room helper: lengths in feet and inches, room sizes in square feet, and a number typed without a unit is read as feet. Everything is still stored in metres, and other screens stay in metres.")),
    ]));
  }

  // ── 2D Map Mode (Experimental) ────────────────────────────────────────────
  {
    const settings = ctx.state.settings || {};
    const mode2dOn = settings.overview_2d_mode === true;
    const mode2dToggle = el("input",{type:"checkbox",id:"mode2dToggle",style:"width:16px;height:16px;accent-color:#f59e0b;cursor:pointer"});
    mode2dToggle.checked = mode2dOn;
    mode2dToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ overview_2d_mode: mode2dToggle.checked });
        ctx.toast(mode2dToggle.checked ? t("2D map mode enabled (experimental)") : t("3D isometric map restored"));
        ctx.actions.renderRooms();
      } catch(e){ ctx.toast(t("Failed to save"), true); }
    });
    wrap.appendChild(el("div",{class:"card",style:"margin-top:12px;border-color:" + (mode2dOn ? "#f59e0b" : "#2d4a38")},[
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
        el("div",{class:"h2",style:"margin:0;color:#f59e0b"}, t("2D Map Mode")),
        el("span",{style:"font-size:10px;padding:1px 6px;border-radius:4px;background:#422006;color:#fbbf24;border:1px solid #92400e;font-weight:700"}, t("EXPERIMENTAL")),
      ]),
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
        mode2dToggle,
        el("label",{for:"mode2dToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
          t("Replace 3D isometric view with flat 2D map")),
      ]),
      el("div",{class:"muted",style:"font-size:12px"},
        t("Shows your floor plan image as a flat 2D map with zoom/pan (mouse wheel + drag). Includes toggle filters for scanners, tagged objects, unknown devices, and room boundaries. The map fills more screen space and hides multi-floor controls when only one map is uploaded. This is experimental — the 3D view is still available by toggling this off.")),
    ]));
  }

  return wrap;
}

// ── Scanner Map tab ───────────────────────────────────────────────────────────
// Uses calibration fingerprint data to estimate where each BLE scanner physically
// sits on the floor plans, then renders those guessed positions on each map.
function _scannerMap(ctx, el, haFloors){
  const esc = ctx.helpers.esc;
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const maps  = (ctx.state.maps && ctx.state.maps.list) || [];

  // Load calibration data if not yet loaded
  if(!ctx.state.calibration){
    ctx.actions.calibrationGet()
      .then(d => { ctx.state.calibration = d; ctx.actions.renderRooms(); })
      .catch(() => { ctx.state.calibration = { points:[], model:{} }; ctx.actions.renderRooms(); });
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted",style:"font-size:11px"},t("Loading calibration data…")),
    ]));
    return wrap;
  }

  const calData = ctx.state.calibration;
  const radios  = snap?.ble?.radios || [];

  // Intro card
  wrap.appendChild(el("div",{class:"card",style:"border-color:#52b788;padding:10px"},[
    el("div",{style:"font-weight:700;font-size:13px;margin-bottom:4px;color:#52b788"},t("Where PadSpan Thinks Your Scanners Are")),
    el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.6"},
      t("Each numbered dot shows where PadSpan estimates a Bluetooth scanner is physically located on your floor plan. These positions are calculated from your calibration data — when you collected fingerprints at known locations, each scanner recorded how strong the signal was. Scanners that heard a calibration point loudly are estimated to be closer to it; scanners that heard it faintly are estimated to be further away. The percentage next to each scanner is the confidence in that estimate (more calibration points = higher confidence). If a scanner appears in the wrong place, it means the calibration data is giving conflicting signals — collecting more calibration points near that scanner will improve accuracy.")),
  ]));

  if(!calData.points || calData.points.length === 0){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700;font-size:13px;color:#f59e0b;margin-bottom:4px"},t("⚠ No calibration data")),
      el("div",{class:"muted",style:"font-size:11px"},t("Collect calibration fingerprints in the PadSpan™ Calib panel first.")),
    ]));
    return wrap;
  }

  // Build per-map scanner estimates — ALL scanners heard on each map
  const byMap = _estimatePositionsPerMap(calData, radios);
  const allEstimatedSources = new Set(Object.values(byMap).flatMap(arr => arr.map(r => r.source)));

  // Radios active in snapshot but absent from all calibration data
  const unplacedRadios = radios.filter(r => r.source && !allEstimatedSources.has(r.source));

  const mapIds = Object.keys(byMap);
  if(!mapIds.length){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted",style:"font-size:11px"},t("Could not estimate positions from the available calibration data.")),
    ]));
  }

  // Colour palette — up to 16 distinct scanners per map
  const PALETTE = [
    "#52b788","#60a5fa","#f59e0b","#a78bfa","#fb7185","#34d399",
    "#f472b6","#38bdf8","#fbbf24","#818cf8","#4ade80","#f87171",
    "#22d3ee","#e879f9","#a3e635","#fb923c",
  ];

  for(const mapId of mapIds){
    const mapData  = maps.find(m => m.id === mapId);
    const mapRadios = byMap[mapId];  // sorted by pointCount desc

    const mapCard = el("div",{class:"card",style:"padding:10px"});

    // Card header
    const floorName = _floorNameForMap(mapData, haFloors);
    const nScan = mapRadios.length;
    mapCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px;margin-bottom:8px"},[
      el("div",{style:"font-weight:700;font-size:13px"}, mapData?.name || mapId),
      floorName ? el("span",{class:"badge",style:"font-size:10px"},floorName) : null,
      el("span",{class:"badge",style:"margin-left:auto;font-size:10px"},
        tn(nScan, "{n} scanner", "{n} scanners")),
    ].filter(Boolean)));

    // SVG map with markers
    if(mapData?.image?.filename){
      const ar  = (mapData.image.height || 600) / (mapData.image.width || 800);
      const vbH = ar * 100;
      const imgUrl = ctx.helpers.mapImageUrl(mapData);

      let markersSvg = "";
      mapRadios.forEach((r, i) => {
        const cx  = (r.x_frac * 100).toFixed(2);
        const cy  = (r.y_frac * vbH).toFixed(2);
        const col = PALETTE[i % PALETTE.length];
        const conf = r.confidence;
        const outerR = (1.8 + conf * 3).toFixed(1);   // 1.8–4.8 SVG units
        const confPct = Math.round(conf * 100);

        // Confidence ring
        const ringOp = (0.15 + conf * 0.45).toFixed(2);
        markersSvg += `<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${col}" fill-opacity="0.10" stroke="${col}" stroke-width="0.4" stroke-dasharray="1 0.8" opacity="${ringOp}"/>`;
        // Centre dot
        markersSvg += `<circle cx="${cx}" cy="${cy}" r="1.0" fill="${col}" stroke="white" stroke-width="0.3" opacity="0.95"/>`;
        // Number label on dot
        markersSvg += `<text x="${cx}" y="${(parseFloat(cy)+0.35).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="1.2" fill="white" font-weight="bold">${i+1}</text>`;
        // Scanner name + confidence — compact label above marker
        // Clamp so the label text never gets pushed outside the viewBox (and clipped
        // by the container's overflow:hidden) for scanners near an edge of the map.
        const labelY = Math.max(r.y_frac * vbH - parseFloat(outerR) - 0.5, 2).toFixed(1);
        const labelX = Math.min(Math.max(parseFloat(cx), 8), 92).toFixed(2);
        const shortName = r.name.length > 14 ? r.name.slice(0,12)+"…" : r.name;
        markersSvg += `<text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="1.5" fill="${col}" font-weight="600" paint-order="stroke" stroke="#071008" stroke-width="0.5">${esc(shortName)} ${confPct}%</text>`;
      });

      const mapDiv = el("div",{style:"border-radius:6px;overflow:hidden;border:1px solid #1b3526;margin-bottom:8px"});
      mapDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${vbH}"
        preserveAspectRatio="none" style="width:100%;display:block">
        <image href="${imgUrl}" x="0" y="0" width="100" height="${vbH}" preserveAspectRatio="none"/>
        ${markersSvg}
      </svg>`;
      mapCard.appendChild(mapDiv);
    }

    // Compact legend — one row per scanner
    const legendDiv = el("div",{style:"display:flex;flex-direction:column;gap:2px"});
    mapRadios.forEach((r, i) => {
      const col = PALETTE[i % PALETTE.length];
      const confPct = Math.round(r.confidence * 100);
      const confColor = confPct >= 80 ? "#52b788" : confPct >= 40 ? "#f59e0b" : "#dc2626";
      legendDiv.appendChild(el("div",{
        style:"display:grid;grid-template-columns:16px 1fr auto auto;gap:5px;align-items:center;padding:3px 6px;background:#0a150e;border-radius:5px"
      },[
        // Number badge
        el("div",{style:`width:14px;height:14px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#071008;flex-shrink:0`}, i+1),
        // Name
        el("div",{style:"font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0"}, r.name),
        // Source tail
        el("div",{style:"font-size:10px;color:#4a6670;font-family:monospace;white-space:nowrap"}, r.source.slice(-8)),
        // Confidence + point count
        el("div",{style:`font-size:10px;color:${confColor};white-space:nowrap;text-align:right`},
          `${confPct}% · ${r.pointCount}pt`),
      ]));
    });
    mapCard.appendChild(legendDiv);

    // Clear calibration data for this map
    const pointCount = (calData.points || []).filter(p => p.map_id === mapId).length;
    const clearRow = el("div",{style:"display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid #1b3526"});
    const clearStatusEl = el("span",{class:"muted",style:"font-size:10px;min-width:60px"},"");
    const clearBtnWrap = document.createElement("span");
    clearBtnWrap.style.cssText = "display:inline-flex;gap:4px;align-items:center";
    const makeClearBtn = () => {
      clearBtnWrap.innerHTML = "";
      const cb = el("button",{class:"btn inline",style:"font-size:10px;padding:2px 8px;color:#f87171;border-color:#f8717140",
        title:tn(pointCount, "Remove the {n} calibration point collected on this map", "Remove all {n} calibration points collected on this map"),
        onclick: (ev) => {
          ev.stopPropagation();
          clearBtnWrap.innerHTML = "";
          clearBtnWrap.appendChild(el("span",{style:"font-size:10px;color:#fca5a5"},tn(pointCount, "Clear {n} point?", "Clear {n} points?") + " "));
          clearBtnWrap.appendChild(el("button",{class:"btn inline",style:"font-size:10px;padding:2px 8px;background:#7f1d1d;border-color:#dc2626;color:#fca5a5",
            onclick: async (ev2) => {
              ev2.stopPropagation();
              clearBtnWrap.innerHTML = "";
              clearBtnWrap.appendChild(el("span",{style:"font-size:10px;color:#94a3b8"},t("Clearing…")));
              try {
                const res = await ctx.actions.calibrationClearMap(mapId);
                const n = res?.deleted ?? 0;
                ctx.toast(tn(n, "Cleared {n} calibration point from {map}", "Cleared {n} calibration points from {map}", { map: mapData?.name || mapId }));
                ctx.state.calibration = null;
                ctx.actions.renderRooms();
              } catch(e) {
                ctx.toast(t("Clear failed: {error}", { error: ctx.helpers.errorText(e) }), true);
                makeClearBtn();
              }
            }
          },t("Yes")));
          clearBtnWrap.appendChild(el("button",{class:"btn inline",style:"font-size:10px;padding:2px 8px;color:#94a3b8;border-color:#94a3b840",
            onclick: (ev2) => { ev2.stopPropagation(); makeClearBtn(); }
          },t("No")));
        }
      },t("Clear ({n})", { n: pointCount }));
      clearBtnWrap.appendChild(cb);
    };
    makeClearBtn();
    clearRow.appendChild(el("span",{class:"muted",style:"font-size:10px"},t("Calibration:")));
    clearRow.appendChild(clearBtnWrap);
    clearRow.appendChild(clearStatusEl);
    mapCard.appendChild(clearRow);

    wrap.appendChild(mapCard);
  }

  // Unplaced radios — active but no calibration data anywhere
  if(unplacedRadios.length){
    const unplacedCard = el("div",{class:"card",style:"border-color:#f59e0b;padding:10px"});
    unplacedCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px;margin-bottom:6px"},[
      el("div",{style:"font-weight:700;font-size:12px;color:#f59e0b"},t("⚠ Not yet in calibration data")),
      el("span",{class:"badge warn",style:"font-size:10px;margin-left:auto"},unplacedRadios.length),
    ]));
    for(const r of unplacedRadios){
      const name = r.display_name || r.area_name || r.area || r.name || r.source || "?";
      unplacedCard.appendChild(el("div",{
        style:"display:grid;grid-template-columns:1fr auto auto;gap:5px;align-items:center;padding:3px 6px;background:#0a150e;border-radius:5px;margin-bottom:2px"
      },[
        el("div",{style:"font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, (ctx.helpers.radioShortId ? ctx.helpers.radioShortId(r.source||"")+" " : "") + name),
        el("div",{style:"font-size:10px;color:#4a6670;font-family:monospace;white-space:nowrap"}, r.source.slice(-8)),
        (()=>{ const _ss = ctx.helpers.scannerStatus; if(!_ss){ return r.scanning ? el("span",{class:"badge",style:"font-size:10px"},t("scanning")) : el("span",{class:"badge warn",style:"font-size:10px"},t("idle")); } const ss = _ss(r, snap?.ble?.advertisements); const b = el("span",{class:ss.cls,style:"font-size:10px",title:ss.title},ss.label); if(ss.style) b.style.cssText+="font-size:10px;"+ss.style; return b; })(),
      ]));
    }
    wrap.appendChild(unplacedCard);
  }

  // ── Replace Scanner card ─────────────────────────────────────────────────
  // Collects all source IDs ever seen in calibration data + live radios
  const calSources = new Set();
  for(const pt of calData.points || []){
    for(const sr of pt.scanner_readings || []){ if(sr.source) calSources.add(sr.source); }
  }
  for(const r of radios){ if(r.source) calSources.add(r.source); }

  if(calSources.size >= 2){
    const swapCard = el("div",{class:"card",style:"padding:10px"});
    swapCard.appendChild(el("div",{style:"font-weight:700;font-size:12px;margin-bottom:4px"},t("Replace Scanner")));
    swapCard.appendChild(el("div",{style:"font-size:10px;color:#78909c;margin-bottom:8px;line-height:1.5"},
      t("Reassign all calibration data from one scanner to another — useful when a physical device is swapped out.")));

    // Helper: build an option element
    const mkOpt = (val, label) => {
      const o = document.createElement("option"); o.value=val; o.textContent=label; return o;
    };
    // Name lookup helper
    const radioName = (src) => {
      const r = radios.find(r=>r.source===src);
      return r ? (r.display_name||r.area_name||r.area||r.name||src) : src;
    };
    const sortedSources = [...calSources].sort((a,b)=>radioName(a).localeCompare(radioName(b)));

    const rowEl = el("div",{style:"display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;margin-bottom:8px"});

    const oldSel = document.createElement("select");
    oldSel.style.cssText = "font-size:11px;width:100%";
    oldSel.appendChild(mkOpt("",t("— old radio —")));
    for(const src of sortedSources) oldSel.appendChild(mkOpt(src, radioName(src)));

    const arrowEl = el("div",{style:"font-size:14px;color:#78909c;text-align:center"},"→");

    const newSel = document.createElement("select");
    newSel.style.cssText = "font-size:11px;width:100%";
    newSel.appendChild(mkOpt("",t("— new radio —")));
    for(const src of sortedSources) newSel.appendChild(mkOpt(src, radioName(src)));

    rowEl.appendChild(oldSel);
    rowEl.appendChild(arrowEl);
    rowEl.appendChild(newSel);
    swapCard.appendChild(rowEl);

    // Summary line (updates when selects change)
    const summaryEl = el("div",{style:"font-size:10px;color:#78909c;margin-bottom:8px;min-height:14px"});
    const updateSummary = () => {
      if(!oldSel.value || !newSel.value || oldSel.value === newSel.value){
        summaryEl.textContent = "";
        return;
      }
      const pts = (calData.points||[]).filter(pt =>
        (pt.scanner_readings||[]).some(sr=>sr.source===oldSel.value)
      ).length;
      summaryEl.textContent = tn(pts, "Will update {n} calibration point. This cannot be undone.", "Will update {n} calibration points. This cannot be undone.");
      summaryEl.style.color = pts > 0 ? "#f59e0b" : "#78909c";
    };
    oldSel.addEventListener("change", updateSummary);
    newSel.addEventListener("change", updateSummary);
    swapCard.appendChild(summaryEl);

    // Swap button
    const swapBtnWrap = el("div");
    const makeSwapBtn = () => {
      const btn = el("button",{class:"btn inline",style:"font-size:11px;width:100%"},t("Swap Readings"));
      btn.addEventListener("click", async () => {
        const old_source = oldSel.value;
        const new_source = newSel.value;
        if(!old_source || !new_source){ ctx.toast(t("Select both radios first."), true); return; }
        if(old_source === new_source){ ctx.toast(t("Old and new radio must be different."), true); return; }
        btn.disabled = true; btn.textContent = t("Swapping…");
        try {
          const res = await ctx.actions.calibrationSwapRadio(old_source, new_source);
          ctx.state.calibration = null;  // force reload
          const nUp = res.updated_readings, nDrop = res.dropped_readings, names = { from: radioName(old_source), to: radioName(new_source) };
          ctx.toast(tn(nUp, "Swapped {n} reading from {from} → {to}.", "Swapped {n} readings from {from} → {to}.", names)
            + (nDrop ? " " + tn(nDrop, "{n} point already had {to}'s own reading, kept instead.", "{n} points already had {to}'s own reading, kept instead.", names) : ""));
          ctx.actions.renderRooms();
        } catch(e){
          ctx.toast(t("Swap failed: {error}", { error: ctx.helpers.errorText(e) }), true);
          swapBtnWrap.innerHTML = "";
          swapBtnWrap.appendChild(makeSwapBtn());
        }
      });
      return btn;
    };
    swapBtnWrap.appendChild(makeSwapBtn());
    swapCard.appendChild(swapBtnWrap);
    wrap.appendChild(swapCard);
  }

  // ── Relearn Radio card ──────────────────────────────────────────────────────
  // Adjust calibration data after antenna upgrade/downgrade — shifts all stored
  // RSSI readings for a scanner by a user-provided dB gain.
  if(calSources.size >= 1){
    const relearnCard = el("div",{class:"card",style:"padding:10px"});
    relearnCard.appendChild(el("div",{style:"font-weight:700;font-size:12px;margin-bottom:4px"},t("Relearn Radio")));
    relearnCard.appendChild(el("div",{style:"font-size:10px;color:#78909c;margin-bottom:8px;line-height:1.5"},
      t("Adjust calibration after an antenna upgrade or downgrade. Shifts all stored RSSI readings for the selected scanner by the dB gain you specify.")));

    const radioName = (src) => {
      const r = radios.find(r=>r.source===src);
      return r ? (r.display_name||r.area_name||r.area||r.name||src) : src;
    };
    const rlSorted = [...calSources].sort((a,b)=>radioName(a).localeCompare(radioName(b)));

    const rlRow = el("div",{style:"display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;margin-bottom:8px"});
    const rlSel = document.createElement("select");
    rlSel.style.cssText = "font-size:11px;width:100%";
    rlSel.appendChild((() => { const o = document.createElement("option"); o.value=""; o.textContent=t("— select scanner —"); return o; })());
    for(const src of rlSorted){
      const o = document.createElement("option"); o.value=src; o.textContent=radioName(src); rlSel.appendChild(o);
    }

    const rlGainWrap = el("div",{style:"display:flex;align-items:center;gap:4px"});
    const rlGainInput = document.createElement("input");
    rlGainInput.type = "number"; rlGainInput.min = "-30"; rlGainInput.max = "30"; rlGainInput.step = "1"; rlGainInput.value = "3";
    rlGainInput.style.cssText = "width:48px;text-align:center;background:#0a150e;border:1px solid #2d5a3d;border-radius:4px;color:#e2e8f0;padding:2px 4px;font-size:11px";
    rlGainInput.title = t("Positive = antenna upgrade (stronger signal); Negative = downgrade (weaker)");
    rlGainWrap.appendChild(rlGainInput);
    rlGainWrap.appendChild(el("span",{style:"font-size:10px;color:#78909c"},"dB"));

    rlRow.appendChild(rlSel);
    rlRow.appendChild(rlGainWrap);
    relearnCard.appendChild(rlRow);

    const rlHint = el("div",{style:"font-size:10px;color:#94a3b8;margin-bottom:8px"},
      t("Positive = upgrade (e.g. +3 dB for better antenna). Negative = downgrade."));

    // Summary line
    const rlSummary = el("div",{style:"font-size:10px;color:#78909c;margin-bottom:8px;min-height:14px"});
    const updateRlSummary = () => {
      if(!rlSel.value){ rlSummary.textContent = ""; return; }
      const pts = (calData.points||[]).filter(pt =>
        (pt.scanner_readings||[]).some(sr=>sr.source===rlSel.value)
      ).length;
      const g = parseFloat(rlGainInput.value) || 0;
      rlSummary.textContent = pts > 0
        ? tn(pts, "Will shift {n} calibration point by {db} dB. Model will be recomputed.", "Will shift {n} calibration points by {db} dB. Model will be recomputed.", { db: (g > 0 ? "+" : "") + g })
        : t("No calibration data found for this scanner.");
      rlSummary.style.color = pts > 0 ? "#38bdf8" : "#78909c";
    };
    rlSel.addEventListener("change", updateRlSummary);
    rlGainInput.addEventListener("input", updateRlSummary);
    relearnCard.appendChild(rlHint);
    relearnCard.appendChild(rlSummary);

    // Apply button
    const rlBtnWrap = el("div");
    const makeRlBtn = () => {
      const btn = el("button",{class:"btn inline",style:"font-size:11px;width:100%"},t("Relearn"));
      btn.addEventListener("click", async () => {
        const source = rlSel.value;
        const gain = Math.max(-30, Math.min(30, parseFloat(rlGainInput.value) || 0));
        if(!source){ ctx.toast(t("Select a scanner first."), true); return; }
        if(gain === 0){ ctx.toast(t("Gain must be non-zero."), true); return; }
        btn.disabled = true; btn.textContent = t("Relearning…");
        try {
          const res = await ctx.actions.calibrationRelearnRadio(source, gain);
          ctx.state.calibration = null;
          const nPts = res.updated_points;
          ctx.toast(tn(nPts, "Relearned {name}: {db} dB — {n} point updated.", "Relearned {name}: {db} dB — {n} points updated.", { name: radioName(source), db: (gain > 0 ? "+" : "") + gain }));
          ctx.actions.renderRooms();
        } catch(e){
          ctx.toast(t("Relearn failed: {error}", { error: ctx.helpers.errorText(e) }), true);
          rlBtnWrap.innerHTML = "";
          rlBtnWrap.appendChild(makeRlBtn());
        }
      });
      return btn;
    };
    rlBtnWrap.appendChild(makeRlBtn());
    relearnCard.appendChild(rlBtnWrap);
    wrap.appendChild(relearnCard);
  }

  // Reload button
  wrap.appendChild(el("div",{style:"text-align:center"},[
    el("button",{class:"btn inline",style:"font-size:11px",
      onclick:()=>{ ctx.state.calibration=null; ctx.actions.renderRooms(); }},
      t("Reload calibration data")),
  ]));

  return wrap;
}

// Build per-map scanner estimates — every scanner that heard any calibration point
// on a given map gets an estimated position on that map.
// Returns { mapId: [ {source, name, x_frac, y_frac, pointCount, meanRssi, confidence} ] }
function _estimatePositionsPerMap(calData, radios){
  // acc[mapId][source] = [{x_frac, y_frac, mean_rssi}]
  const acc = {};
  for(const pt of calData.points || []){
    for(const sr of pt.scanner_readings || []){
      if(!sr.source || !sr.rssi_samples?.length) continue;
      const meanRssi = sr.rssi_samples.reduce((a,b)=>a+b,0) / sr.rssi_samples.length;
      if(!acc[pt.map_id]) acc[pt.map_id] = {};
      if(!acc[pt.map_id][sr.source]) acc[pt.map_id][sr.source] = [];
      acc[pt.map_id][sr.source].push({ x_frac:pt.x_frac, y_frac:pt.y_frac, mean_rssi:meanRssi });
    }
  }

  const result = {};
  for(const [mapId, bySource] of Object.entries(acc)){
    result[mapId] = [];
    for(const [source, pts] of Object.entries(bySource)){
      // dBm -> linear power ratio: a scanner heard 10dB louder gets 10x the pull
      // on the estimated position (deliberate physics-based weighting).
      const weights = pts.map(p => Math.pow(10, p.mean_rssi / 10));
      const totalW  = weights.reduce((a,b)=>a+b, 0);
      const x = pts.reduce((s,p,i) => s + p.x_frac * weights[i], 0) / totalW;
      const y = pts.reduce((s,p,i) => s + p.y_frac * weights[i], 0) / totalW;
      const meanRssi  = Math.round(pts.reduce((s,p)=>s+p.mean_rssi,0) / pts.length);
      // 6 calibration points is the chosen threshold at which confidence saturates to 100%.
      const confidence = Math.min(1, pts.length / 6);
      // Resolve display name from live snapshot radios
      const radio = radios.find(r => r.source === source);
      const name  = radio?.area_name || radio?.area || radio?.name || source;
      result[mapId].push({ source, name, x_frac:x, y_frac:y, pointCount:pts.length, meanRssi, confidence });
    }
    // Sort: most calibration points first
    result[mapId].sort((a,b) => b.pointCount - a.pointCount);
  }
  return result;
}

function _floorNameForMap(mapData, haFloors){
  if(!mapData) return null;
  const fid = mapData.floor_id;
  if(!fid) return null;
  const f = haFloors.find(f=>f.id===fid);
  return f ? (f.name || f.id) : fid;
}

function _toHex(c){
  const s = String(c||"").trim();
  if(/^#[0-9a-f]{6}$/i.test(s)) return s;
  const tmp = document.createElement("div");
  tmp.style.color = s;
  document.body.appendChild(tmp);
  const rgb = getComputedStyle(tmp).color;
  tmp.remove();
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if(!m) return "#888888";
  const r = Number(m[1])|0, g=Number(m[2])|0, b=Number(m[3])|0;
  return "#" + [r,g,b].map(x=>x.toString(16).padStart(2,"0")).join("");
}

// ── Presence tab ────────────────────────────────────────────────────────────────
// ── Settings → Presence in sections (2026-10-30) ──────────────────────────
// [key, heading], most-used first. Every card on the tab goes into exactly
// one of them through put() (tests/test_settings_sections.py). A section
// folds to its heading; a folded one is remembered in this browser
// (padspan_settings_fold_<key> = "0"), and every section is open until
// someone folds it.
// i18n part: tracking
export const PRESENCE_SECTIONS = [
  ["rooms",        () => t("Rooms and timing")],
  ["phones",       () => t("Phones and guest tags")],
  ["shown",        () => t("What the panel shows")],
  ["positioning",  () => t("Positioning and calibration")],
  ["receivers",    () => t("Receivers")],
  ["performance",  () => t("Performance")],
  ["integrations", () => t("Home Assistant and integrations")],
  ["privacy",      () => t("Privacy, updates and feedback")],
];
const _FOLD = "padspan_settings_fold_";
const _foldClosed = (key) => { try { return localStorage.getItem(_FOLD + key) === "0"; } catch (_) { return false; } };
const _foldSave = (key, open) => { try { if (open) localStorage.removeItem(_FOLD + key); else localStorage.setItem(_FOLD + key, "0"); } catch (_) {} };

function _presenceSections(ctx, el, bins){
  // A link that lands on one card opens its section: "Become a tester" (the
  // report's card) and anything that sets state._presenceReveal once.
  const reveal = ctx.state._testerFocus === true ? "privacy" : ctx.state._presenceReveal;
  ctx.state._presenceReveal = null;
  const out = [];
  for (const [key, title] of PRESENCE_SECTIONS) {
    const cards = bins[key] || [];
    if (!cards.length) continue;
    if (reveal === key) _foldSave(key, true);
    const open = !_foldClosed(key);
    const chev = el("span", { style: "display:inline-block;width:14px;color:#52b788;font-size:16px;line-height:1" }, open ? "▾" : "▸");
    // The section's own help (help_content.js settings_tracking_<key>). A
    // click on it opens the help and must not fold the section as well.
    const help = ctx.helpers.helpBtn ? ctx.helpers.helpBtn("settings_tracking_" + key) : null;
    if (help) help.addEventListener("click", (e) => e.preventDefault());
    const det = el("details", { "data-presence-section": key }, [
      el("summary", { style: "cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid #1b3526;user-select:none" }, [
        chev,
        el("span", { style: "font-weight:700;font-size:14px;color:#52b788" }, title()),
        help,
      ]),
      el("div", { style: "display:flex;flex-direction:column;gap:12px;margin-top:12px" }, cards),
    ]);
    det.open = open;
    det.addEventListener("toggle", () => { chev.textContent = det.open ? "▾" : "▸"; _foldSave(key, det.open); });
    out.push(det);
  }
  return out;
}

function _settingsPresence(ctx, el){
  const helpBtn = ctx.helpers.helpBtn;
  const settings = ctx.state.settings || {};
  const inpStyle = "width:72px;text-align:center;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:13px";
  const rowStyle = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px";
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  // Each card goes into one section (PRESENCE_SECTIONS); they are drawn at the end.
  const bins = {};
  const put = (key, node) => { (bins[key] = bins[key] || []).push(node); };
  wrap.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
    el("div",{style:"font-weight:700;font-size:15px;color:#52b788"},t("Tracking Settings")),
    helpBtn("settings_presence"),
  ]));

  // ── Quiet Mode ────────────────────────────────────────────────────────────
  // Switched in one place: the Quiet tick at the top of the Overview, which
  // Basic mode has too (it has no Presence tab). With the Atlas as Overview
  // that tick is on Pure Live's classic Overview side. This card explains it
  // and links there.
  {
    const quietOn = settings.quiet_mode === true;
    const atlasHome = settings.overview_atlas === true && tierAtLeast(settings.tier, "pro");
    const quietGo = el("button",{class:"btn inline","data-goto":"overview-quiet"}, atlasHome ? t("Open the classic Overview") : t("Open the Overview"));
    quietGo.addEventListener("click", ()=>{
      if (atlasHome) { ctx.state.view = "purelive"; ctx.state._liveClassic = true; }
      else ctx.state.view = "overview";
      if (ctx.actions.renderNav) ctx.actions.renderNav();
      ctx.actions.renderRooms();
    });
    put("shown", el("div",{class:"card",style:"border-color:" + (quietOn ? "#52b788" : "#2d4a38")},[
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
        el("div",{class:"h2",style:"margin:0;color:#52b788"}, t("Quiet Mode")),
      ]),
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap"},[
        el("span",{style:"font-size:13px;color:#e2e8f0;font-weight:600"},
          quietOn ? t("On: only identified & followed objects are shown.") : t("Off: all objects are shown.")),
        el("span",{class:"muted",style:"font-size:12px"}, t("Switch it with the Quiet tick at the top of the Overview.")),
        quietGo,
      ]),
      el("div",{class:"muted",style:"font-size:12px"},
        t("Hides all unidentified BLE devices from Devices → By Room, overview counts, and dropdowns. Scanning continues in the background so tracked objects still work. It only changes what this panel shows, not how much work Home Assistant or PadSpan does. Ideal for busy environments (condos, offices) where you only care about your own devices. Turn off when you need to discover and tag new objects.")),
    ]));
  }

  // ── Guest tags (guest_tags.py, 0.38.178): off until turned on here ───────
  {
    const gOn = settings.guest_tags_enabled === true;
    const gToggle = el("input",{type:"checkbox",style:"width:16px;height:16px;accent-color:#fbbf24;cursor:pointer"});
    gToggle.checked = gOn;
    gToggle.addEventListener("change", async()=>{
      if (gToggle.checked && !confirm(t("Turn on guest tags?\n\nA tag you lend to a guest (a house-sitter, a visitor, a cleaner) is followed room by room while they have it, and you can be told when they arrive, leave or go into a room you choose.\n\nTell your guests the tag is tracked."))) { gToggle.checked = false; return; }
      try {
        await ctx.actions.settingsSet({ guest_tags_enabled: gToggle.checked });
        ctx.toast(gToggle.checked ? t("Guest tags on — see the Guests tab") : t("Guest tags off"));
        ctx.actions.renderRooms();
      } catch(e){ gToggle.checked = !gToggle.checked; ctx.toast(t("Failed to save: {error}", { error: ctx.helpers.errorText(e) }), true); }
    });
    const keep = el("select",{class:"select",style:"width:auto"});
    for (const [v, lab] of [[0,t("not kept")],[7,t("7 days")],[30,t("30 days")],[90,t("90 days")]]) keep.appendChild(el("option",{value:String(v)}, lab));
    keep.value = String(settings.guest_retention_days ?? 30);
    keep.addEventListener("change", async()=>{
      try { await ctx.actions.settingsSet({ guest_retention_days: parseInt(keep.value, 10) }); ctx.toast(t("Saved")); }
      catch(e){ ctx.toast(t("Failed to save: {error}", { error: ctx.helpers.errorText(e) }), true); }
    });
    put("phones", el("div",{class:"card","data-focus-part":"guest_tags",style:"border-color:" + (gOn ? "#fbbf24" : "#2d4a38")},[
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
        el("div",{class:"h2",style:"margin:0;color:#fbbf24"}, t("Guest tags")),
        helpBtn("guest_tags"),
      ]),
      el("div",{style:rowStyle},[ gToggle, el("span",{style:"font-size:13px;color:#e2e8f0"}, t("Use tags as guest tags")) ]),
      el("div",{class:"muted",style:"font-size:12px;margin:4px 0 8px;line-height:1.5"},
        t("Lend a tag PadSpan already knows (a beacon, a Find My tag, a spare phone) to a guest. While they have it, the Guests tab shows where they are, when they arrived and left, and how long they spent in each room, and you can be told when they arrive, leave, or go into a room you set as off-limits. A house-sitter can count as someone home for Vacation Mode. Off: nothing is tracked or kept, and the Guests tab is hidden.")),
      el("div",{style:rowStyle},[ el("span",{style:"font-size:12px;color:#94a3b8"},t("Keep a finished stay's report (name, times, rooms) for")), keep ]),
      el("div",{class:"muted",style:"font-size:11px"},
        t("Guests' names stay in this Home Assistant: never in the usage report, never in a backup. Only an administrator can lend a tag or end a stay.")),
    ]));
  }

  // ── Yesterday at home (presence_coordinator.async_send_yesterday_home): off by default ──
  // One morning message about the day before, from Traceback's frames.
  {
    const yOn = settings.yesterday_home_enabled === true;
    const save = async (patch) => {
      try { await ctx.actions.settingsSet(patch); ctx.toast(t("Saved")); return true; }
      catch(e){ ctx.toast(t("Failed to save: {error}", { error: ctx.helpers.errorText(e) }), true); return false; }
    };
    const yToggle = el("input",{type:"checkbox",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    yToggle.checked = yOn;
    yToggle.addEventListener("change", async()=>{
      if (!(await save({ yesterday_home_enabled: yToggle.checked }))) yToggle.checked = !yToggle.checked;
      else ctx.actions.renderRooms();
    });
    const yTime = el("input",{type:"time",class:"input",style:"width:auto"});
    yTime.value = settings.yesterday_home_time || "08:00";
    yTime.addEventListener("change", ()=>{ if (yTime.value) save({ yesterday_home_time: yTime.value }); });
    const yTarget = el("select",{class:"select",style:"width:auto;max-width:100%"});
    yTarget.appendChild(el("option",{value:""}, t("A Home Assistant notification")));
    const fill = (list) => {
      for (const svc of list || []) yTarget.appendChild(el("option",{value:svc}, svc));
      const cur = settings.yesterday_home_target || "";
      if (cur && ![...yTarget.options].some(o => o.value === cur)) yTarget.appendChild(el("option",{value:cur}, cur));
      yTarget.value = cur;
    };
    if (Array.isArray(ctx.state._notifyServices) && ctx.state._notifyServices.length) fill(ctx.state._notifyServices);
    else { fill([]); ctx.actions.wsCall("padspan_ha/notify_services_list", {}).then(r => {
      ctx.state._notifyServices = (r && r.services) || [];
      while (yTarget.options.length > 1) yTarget.remove(1);
      fill(ctx.state._notifyServices);
    }).catch(() => {}); }
    yTarget.addEventListener("change", ()=>save({ yesterday_home_target: yTarget.value }));
    const have = new Set(Array.isArray(settings.yesterday_home_lines) ? settings.yesterday_home_lines : ["comings","guests","empty_rooms","lights"]);
    const lineBoxes = [];
    const lineRow = el("div",{style:"display:flex;flex-direction:column;gap:4px;margin:4px 0 8px"});
    for (const [w, label] of [["comings", t("Who came and went, and when")], ["guests", t("Guest tags that arrived or left")],
                              ["empty_rooms", t("The rooms empty longest")], ["lights", t("Lights left on in rooms where nobody was")]]) {
      const c = el("input",{type:"checkbox",style:"accent-color:#52b788"});
      c.checked = have.has(w); c.value = w;
      c.addEventListener("change", ()=>save({ yesterday_home_lines: lineBoxes.filter(b => b.checked).map(b => b.value) }));
      lineBoxes.push(c);
      lineRow.appendChild(el("label",{style:"font-size:13px;color:#e2e8f0;display:flex;gap:6px;align-items:center"},[c, label]));
    }
    put("phones", el("div",{class:"card",style:"border-color:" + (yOn ? "#52b788" : "#2d4a38")},[
      el("div",{class:"h2",style:"margin:0 0 4px;color:#52b788"}, t("Yesterday at home")),
      el("div",{style:rowStyle},[ yToggle, el("span",{style:"font-size:13px;color:#e2e8f0"}, t("Send a morning message about the day before")) ]),
      el("div",{class:"muted",style:"font-size:12px;margin:4px 0 8px;line-height:1.5"},
        t("One short message a day through Home Assistant: who came and went and when, guest tags that arrived or left, the rooms empty longest, and lights left on in rooms where nobody was. The figures are Traceback's for that day, and the message links to it. A day with none of these says \"Nothing to report\".")),
      el("div",{style:rowStyle},[ el("span",{style:"font-size:12px;color:#94a3b8"},t("Send it at")), yTime ]),
      el("div",{style:rowStyle},[ el("span",{style:"font-size:12px;color:#94a3b8"},t("Send it to")), yTarget ]),
      el("div",{style:"font-size:12px;color:#94a3b8"}, t("What it tells")),
      lineRow,
      el("div",{class:"muted",style:"font-size:11px"},
        t("Only an administrator can change this. Turned on after today's time, the first message comes tomorrow.")),
    ]));
  }

  // ── Fabric source ─────────────────────────────────────────────────────────
  // "Runs without Home Assistant areas" — the fabric is the model, and this
  // decides whether HA's registry gets to write into it.
  {
    const cur = (ctx.state.model && ctx.state.model.fabric_sync_mode) || "auto";
    const sel = el("select", {
      style: "width:220px;background:#0a150e;color:#e2e8f0;border:1px solid #2d5a3d;border-radius:6px;padding:4px 8px;font-size:13px",
    });
    for (const [v, label] of [["auto", t("Follow Home Assistant areas")],
                              ["manual", t("Standalone — use the saved layout")]]) {
      const o = el("option", { value: v }, label);
      if (cur === v) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", async () => {
      try {
        await ctx.actions.callWS({ type: "padspan_ha/fabric_sync_mode_set", mode: sel.value });
        ctx.toast(sel.value === "manual"
          ? t("Standalone — rooms and scanners come from the saved layout only")
          : t("Following Home Assistant areas"));
        await ctx.actions.modelRefresh();
      } catch(e) { ctx.toast(t("Failed to save"), true); }
    });
    put("integrations", el("div", { class: "card" }, [
      el("div", { class: "h2", style: "color:#52b788" }, t("Room and receiver layout source")),
      el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [sel]),
      el("div", { class: "muted", style: "font-size:12px" },
        t("Standalone lets PadSpan run with rooms you created here and no Home Assistant areas at all.")),
    ]));
  }

  // ── Positioning Algorithm ─────────────────────────────────────────────────
  {
    const cs = (ctx.state.live && ctx.state.live.snapshot && ctx.state.live.snapshot.calibration_status) || {};
    const curAlgo = settings.positioning_algorithm || "knn";
    const rfReady = cs.rf_trained === true;
    // With matching chosen the model is not trained at all (it trains when
    // chosen): not a fault (calibration_store.rf_state).
    const rfUnused = cs.rf_state === "not_used";
    const rfTraining = cs.rf_state === "training";
    const algoSel = el("select", {
      style: "width:180px;background:#0a150e;color:#e2e8f0;border:1px solid #2d5a3d;border-radius:6px;padding:4px 8px;font-size:13px",
    });
    const optKnn = el("option", { value: "knn", title: t("k-NN (k-nearest neighbours)") }, t("Matched to calibration points (default)"));
    const optRf = el("option", { value: "rf", title: "Random Forest" }, (rfReady || rfUnused ? t("Learned model (experimental)") : t("Learned model (experimental) — not trained")));
    if (curAlgo === "knn") optKnn.selected = true;
    else optRf.selected = true;
    algoSel.appendChild(optKnn);
    algoSel.appendChild(optRf);
    algoSel.addEventListener("change", async () => {
      try {
        await ctx.actions.settingsSet({ positioning_algorithm: algoSel.value });
        ctx.toast(t("Positioning algorithm: {name}", { name: algoSel.value === "rf" ? t("Learned model") : t("Matched to calibration points") }));
        ctx.actions.renderRooms();
      } catch(e) { ctx.toast(t("Failed to save"), true); }
    });
    put("positioning", el("div", { class: "card" }, [
      el("div", { class: "h2", style: "color:#52b788" }, t("Positioning Algorithm")),
      el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [
        algoSel,
        el("span", { class: "muted", style: "font-size:12px" },
          curAlgo === "rf" ? (rfReady ? t("Active") : rfTraining ? t("Training — matching calibration points until it is ready")
            : t("Falling back to matching calibration points")) : ""),
      ]),
      el("div", { class: "muted", style: "font-size:12px;line-height:1.6" },
        t("Matched to calibration points compares live signals to the nearest calibration points — works well even with sparse scanner coverage. The learned model (experimental) trains a decision-tree model — needs dense multi-scanner overlap per object to do better than matching. Both use the same calibration dataset — switching is instant and safe.")),
    ]));
  }

  // ── Room change delay ──────────────────────────────────────────────────────
  const currentDelay = (settings.room_change_delay_s != null ? Number(settings.room_change_delay_s) : 40);
  const _pollInt = (settings.presence_poll_interval_s != null ? Number(settings.presence_poll_interval_s) : 5);
  const polls = Math.max(1, Math.round(currentDelay / _pollInt));
  const delayInp = el("input", {
    type: "number", min: "0", max: "300", step: "5", value: String(currentDelay), style: inpStyle,
  });
  const delaySaveBtn = el("button", { class: "btn" }, t("Save"));
  delaySaveBtn.addEventListener("click", async () => {
    const v = Math.max(0, Math.min(300, parseFloat(delayInp.value) || 0));
    try {
      await ctx.actions.settingsSet({ room_change_delay_s: v });
      ctx.toast(t("Room change delay set to {v}s", { v }));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("rooms", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Room Change Delay")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("How long a scanner must consistently dominate before PadSpan switches a device to a new room. Higher values prevent flickering when a device sits on the boundary between two scanners. A clear move into a next-door room (its scanner well ahead) needs half of it, at least two polls.")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Room change delay")),
      delayInp,
      el("div", { class: "muted", style: "font-size:12px" }, t("seconds")),
      delaySaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      tn(polls, "Current: {delay}s → requires ~{n} consecutive {poll}s poll agreement.", "Current: {delay}s → requires ~{n} consecutive {poll}s polls agreement.", { delay: currentDelay, poll: _pollInt }) +
      " " + t("Set to 0 to switch on the first poll that agrees (indoor↔outdoor and far-apart rooms still need the stricter checks).")
    ),
  ]));

  // ── Hold room through a short gap (hold_last_room_s, display only) ──────────
  const currentHold = (settings.hold_last_room_s != null ? Number(settings.hold_last_room_s) : 0);
  const holdInp = el("input", {
    type: "number", min: "0", max: "600", step: "10", value: String(currentHold), style: inpStyle,
  });
  const holdSaveBtn = el("button", { class: "btn" }, t("Save"));
  holdSaveBtn.addEventListener("click", async () => {
    const v = Math.max(0, Math.min(600, parseFloat(holdInp.value) || 0));
    try {
      await ctx.actions.settingsSet({ hold_last_room_s: v });
      ctx.toast(v > 0 ? t("Room held through gaps up to {v}s", { v }) : t("Room hold off"));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("rooms", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Hold Room Through Short Gaps")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("When a device goes quiet for a minute and comes back, PadSpan forgets its room until the room vote agrees again, so it can show no room for a few polls. With this on, the panel keeps showing the room it was in before the gap, for up to this many seconds. Display only: how rooms are decided does not change.")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Hold last room")),
      holdInp,
      el("div", { class: "muted", style: "font-size:12px" }, t("seconds")),
      holdSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      t("Current: {hold}. 0 = off (default). Range: 0–600s.", { hold: currentHold > 0 ? currentHold + "s" : t("off") })
    ),
  ]));

  // ── "Why this room" sensor attribute (room_reason_attribute) ────────────────
  {
    const reasonOn = settings.room_reason_attribute === true;
    const reasonToggle = el("input",{type:"checkbox",id:"roomReasonToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    reasonToggle.checked = reasonOn;
    reasonToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ room_reason_attribute: reasonToggle.checked });
        ctx.toast(reasonToggle.checked ? t("Room reason attribute on") : t("Room reason attribute off"));
      } catch(e){ ctx.toast(t("Failed to save"), true); }
    });
    put("rooms", el("div",{class:"card"},[
      el("div",{class:"h2"}, t("Why This Room (Sensor Attribute)")),
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
        reasonToggle,
        el("label",{for:"roomReasonToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
          t("Add a room_reason attribute to each area sensor")),
      ]),
      el("div",{class:"muted",style:"font-size:12px"},
        t("Shows in Home Assistant why a device is in its room: how many recent polls voted for it and how many it needs, whether a jump to a far room is being held back, whether the current room was kept although another read slightly stronger, the positioning step's note, the top room scores, and whether the room is being held through a gap. Useful for fixing flapping rooms. Off by default; it adds to what the recorder stores.")),
    ]));
  }

  // ── Honest accuracy: three positioning choices, all off by default ─────────
  {
    const rows = [
      ["positioning_pick_better", t("Pick the better method for this house"),
       t("PadSpan places devices two ways: from the radios' positions (spatial) and from your calibration points (fingerprints). With this on, it uses whichever one did better on calibration spots it had not seen (Calibration → Model shows both). It only switches on a clear win, so it does not flip back and forth. Needs calibration points.")],
      ["positioning_unsure", t("Mark a room as unsure when the signal is thin"),
       t("When fewer than 3 scanners hear a device, or no calibration point matches it well, the device keeps the room it had and is marked unsure (a room_unsure attribute) instead of being moved on weak evidence.")],
      ["positioning_sensor_fusion", t("Use motion sensors and usual moves to break ties"),
       t("When two rooms read almost the same, a motion, occupancy or presence sensor in one of them, and the room-to-room moves PadSpan has learned, decide between them. It never picks a room no scanner hears. In a busy house a motion sensor may be someone else, so this is off by default.")],
    ];
    const card = el("div", { class: "card" }, [el("div", { class: "h2" }, t("Positioning Choices"))]);
    for (const [key, label, help] of rows) {
      const id = "hacc_" + key;
      const tg = el("input", { type: "checkbox", id, style: "width:16px;height:16px;accent-color:#52b788;cursor:pointer" });
      tg.checked = settings[key] === true;
      tg.addEventListener("change", async () => {
        try {
          await ctx.actions.settingsSet({ [key]: tg.checked });
          ctx.toast(`${label}: ${tg.checked ? t("on") : t("off")}`);
        } catch (e) { ctx.toast(t("Failed to save"), true); }
      });
      card.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;margin:10px 0 4px" }, [
        tg,
        el("label", { for: id, style: "font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600" }, label),
      ]));
      card.appendChild(el("div", { class: "muted", style: "font-size:12px" }, help));
    }
    card.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:10px" },
      t("All off by default. Off, rooms and positions are worked out exactly as before.")));
    put("positioning", card);
  }

  // ── Walk a room (calibration_room_walk, on by default) ──────────────────────
  {
    const id = "calib_room_walk";
    const tg = el("input", { type: "checkbox", id, style: "width:16px;height:16px;accent-color:#52b788;cursor:pointer" });
    tg.checked = settings.calibration_room_walk === true;
    tg.addEventListener("change", async () => {
      try {
        await ctx.actions.settingsSet({ calibration_room_walk: tg.checked });
        ctx.toast(t("Walk a room: {state}", { state: tg.checked ? t("on") : t("off") }));
      } catch (e) { ctx.toast(t("Failed to save"), true); }
    });
    put("positioning", el("div", { class: "card", "data-focus-part": "room_walk" }, [
      el("div", { class: "h2" }, t("Walk a Room (Calibration)")),
      el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:10px" }, [
        tg,
        el("label", { for: id, style: "font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600" },
          t("Add a \"Walk a room\" tab to Calibration")),
      ]),
      el("div", { class: "muted", style: "font-size:12px" },
        t("Pick a room, then walk slowly around it for 90 seconds with your phone or tag. PadSpan shows what it heard and how different the room looks from the others, and saves the walk as calibration points only when you say so. Walks can be replaced or removed room by room without touching any other calibration. Turning this off hides the tab but keeps saved walks in positioning; to take one out, use Remove on that room's walk. Off by default.")),
    ]));
  }

  // ── Presence Poll Interval ──────────────────────────────────────────────────
  const currentPoll = (settings.presence_poll_interval_s != null ? Number(settings.presence_poll_interval_s) : 5);
  const pollInp = el("input", {
    type: "number", min: "1", max: "60", step: "1", value: String(currentPoll), style: inpStyle,
  });
  const pollSaveBtn = el("button", { class: "btn" }, t("Save"));
  pollSaveBtn.addEventListener("click", async () => {
    const v = Math.max(1, Math.min(60, parseInt(pollInp.value) || 5));
    try {
      await ctx.actions.settingsSet({ presence_poll_interval_s: v });
      ctx.toast(t("Poll interval set to {seconds}s", { seconds: v }));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("performance", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Presence Poll Interval")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("How often the smoothing pipeline runs to update room assignments. Lower values give faster room transitions but use more CPU. Higher values reduce load on low-end hardware.")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Poll interval")),
      pollInp,
      el("div", { class: "muted", style: "font-size:12px" }, t("seconds")),
      pollSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      t("Current: {seconds}s. Default: 5s. Range: 1–60s.", { seconds: currentPoll })
    ),
    // Installs from before 0.21 kept the old 10 s default (it was never
    // changed for them: 10 s may also be someone's choice). Say so, once.
    currentPoll === 10 ? el("div", { class: "muted", style: "font-size:11px;margin-top:6px;color:#fbbf24" },
      t("10 s was the default before PadSpan 0.21. At 5 s a room change needs half the wait for the same Room Change Delay. Keep 10 s if you chose it for a slow machine.")) : null,
  ]));

  // ── CPU Mode ───────────────────────────────────────────────────────────────
  const cpuMode = (settings.cpu_mode || "shared").toLowerCase();
  const pinOk = !!ctx.state.cpuPinningSupported;
  const cpuSel = el("select", { style:
    "font-size:13px;background:#071008;color:#e2e8f0;border:1px solid #2d4a38;border-radius:4px;padding:5px 8px" });
  const cpuOpts = [
    ["shared", t("Shared — fastest updates, competes with HA")],
    ["single", t("Single core — capped at one core, HA stays responsive")],
  ];
  if (pinOk) cpuOpts.push(["dedicated", t("Dedicated core — own pinned core, zero contention")]);
  for (const [val, label] of cpuOpts) {
    const opt = el("option", { value: val }, label);
    if (val === cpuMode) opt.selected = true;
    cpuSel.appendChild(opt);
  }
  cpuSel.addEventListener("change", async () => {
    try {
      await ctx.actions.settingsSet({ cpu_mode: cpuSel.value });
      ctx.toast(t("CPU mode: {mode}", { mode: cpuSel.value }));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("performance", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("CPU Mode")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("Where the presence-smoothing computation runs. Shared runs it on Home Assistant's main loop (fastest, but can slow HA on low-core hardware like a Pi). Single core moves it to a background worker capped at one core so HA stays responsive.") +
      (pinOk ? " " + t("Dedicated core additionally pins that worker to its own CPU core.") : "")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("CPU mode")),
      cpuSel,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      t("Applies from the next poll cycle — no restart needed.") +
      (pinOk ? "" : " " + t("(Dedicated core is unavailable on this platform.)"))
    ),
  ]));

  // ── Low-memory mode (low_memory.py) ────────────────────────────────────────
  // For a 2 GB machine. What it turns off is listed on the card itself and
  // again in the confirm, so nobody switches it on without reading it.
  const lowMemOn = !!settings.low_memory_mode;
  const lowMemLimits =
    t("• Passing Bluetooth devices nobody has identified are kept for 15 minutes on the air (not up to 4 hours) and at most 2,000 of them.\n• The device list keeps at most 2,000 unidentified devices, for 1 day at most.\n• The Monitor's advertisement list shows at most 2,000.\nYour tagged, labelled and followed devices, positioning, the Atlas and Live Aboard are not affected.");
  const lowMemBtn = el("button", { class: "btn inline", style: lowMemOn
    ? "background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
    : "color:#94a3b8" }, lowMemOn ? t("On") : t("Off"));
  lowMemBtn.addEventListener("click", async () => {
    if (!lowMemOn && !confirm(t("Turn on low-memory mode?") + "\n\n" + lowMemLimits)) return;
    try {
      await ctx.actions.settingsSet({ low_memory_mode: !lowMemOn });
      ctx.toast(!lowMemOn ? t("Low-memory mode on") : t("Low-memory mode off"));
      ctx.actions.renderRooms();
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("performance", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Low-memory mode")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
      t("For a Home Assistant machine with 2 GB of RAM. Next to a busy street PadSpan hears thousands of passing devices, and holding them all can run a 2 GB machine out of memory. This caps how many it holds.")
    ),
    el("div", { style: "font-size:12px;white-space:pre-line;margin-bottom:12px;padding:8px 10px;" +
      "border:1px solid #b45309;border-radius:6px;background:rgba(180,83,9,.12);color:#fcd34d" },
      t("What it turns off:") + "\n" + lowMemLimits),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Low-memory mode")),
      lowMemBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      t("Applies from the next update — no restart needed.")
    ),
  ]));

  // ── Optimize for scale (0.38.178) ──────────────────────────────────────────
  // Several wall screens at once. Off by default: one screen gets nothing
  // from it, and the Overview then shows only the devices it can draw.
  const scaleOn = !!settings.optimize_for_scale;
  const scaleWhat =
    t("• The Overview and the Atlas's 3D people ask for a slim update: the people, tags and devices it can draw, with the counts, instead of every passing Bluetooth device (about 2 MB a screen every 5 seconds in a busy house).\n• Screens polling close together share one update (within 4.5 s instead of 2 s), so Home Assistant builds it about once per poll however many screens are on.\n• A screen whose page is hidden (display off, tab in the background) asks for nothing until it is shown again.\nMonitor, Devices, Bluetooth and every other view still get everything. On the Overview, the list behind the objects count shows only what the slim update carries.");
  const scaleBtn = el("button", { class: "btn inline", style: scaleOn
    ? "background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
    : "color:#94a3b8" }, scaleOn ? t("On") : t("Off"));
  scaleBtn.addEventListener("click", async () => {
    try {
      await ctx.actions.settingsSet({ optimize_for_scale: !scaleOn });
      ctx.toast(!scaleOn ? t("Optimize for scale on") : t("Optimize for scale off"));
      ctx.actions.renderRooms();
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("performance", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Optimize for scale")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
      t("For houses with several wall screens or tablets showing PadSpan at once. It cuts what each screen asks Home Assistant for, which matters most in a busy house or on a small machine (a Raspberry Pi).")
    ),
    el("div", { style: "font-size:12px;white-space:pre-line;margin-bottom:12px;padding:8px 10px;" +
      "border:1px solid #2d4a38;border-radius:6px;background:rgba(82,183,136,.06);color:#b0c4b1" },
      t("What it does:") + "\n" + scaleWhat),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Optimize for scale")),
      scaleBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      t("Applies from the next update — no restart needed. Each screen picks it up within 30 seconds.")
    ),
  ]));

  // ── Update Check ───────────────────────────────────────────────────────────
  const updChkOn = settings.update_check_enabled !== false;
  const updChkBtn = el("button", { class: "btn inline", style: updChkOn
    ? "background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
    : "color:#94a3b8" }, updChkOn ? t("Enabled") : t("Disabled"));
  updChkBtn.addEventListener("click", async () => {
    try {
      await ctx.actions.settingsSet({ update_check_enabled: !updChkOn });
      ctx.toast(!updChkOn ? t("Update check enabled") : t("Update check disabled"));
      ctx.actions.renderRooms();
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("privacy", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Update Check")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("Once a day PadSpan asks padspan.traks.ca whether a newer version exists and notifies you when one is available. The request contains only your installed version number; the server sees your IP address (as any web request does) and stores nothing else about you. Turning it off stops this check. If you've entered a licence key, it is still checked with traks.ca once a day, so a refunded key stops working.")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Update check")),
      updChkBtn,
    ]),
  ]));

  // ── Device makers ──────────────────────────────────────────────────────────
  // Nothing to switch: nothing is sent (ble_enrichment.py, device_tables.py).
  put("privacy", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Device makers")),
    el("div", { class: "muted", style: "font-size:12px" },
      t("PadSpan names a device's maker from what the device itself broadcasts and from lists built into PadSpan (Bluetooth's official company and service numbers, and IEEE's list of address makers). Nothing is sent anywhere for this. The address list counts as fact only for an address a Bluetooth receiver has confirmed is fixed and maker-assigned (ESPHome proxies on version 2022.12 or newer and Home Assistant's own Bluetooth say so, and PadSpan remembers it). Shelly, ESPresense and Tasmota don't say, so there a match reads \"Probably\". An address a receiver reports as random is never looked up.")
    ),
  ]));

  // ── Enhanced security ──────────────────────────────────────────────────────
  // OFF by default; only an administrator turns it on or off (ws_settings).
  // While it is on, the backend's require_admin_if_enhanced (ws_common)
  // refuses changes to the home's shared setup from anyone else. New
  // protections go behind the same switch: add them to the list below too.
  const secOn = settings.enhanced_security === true;
  const secAdmin = !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
  const secBtn = el("button", { class: "btn inline", style: secOn
    ? "background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
    : "color:#94a3b8" }, secOn ? t("On") : t("Off"));
  if (!secAdmin) { secBtn.disabled = true; secBtn.title = t("Only an administrator can change this"); }
  secBtn.addEventListener("click", async () => {
    try {
      await ctx.actions.settingsSet({ enhanced_security: !secOn });
      ctx.toast(!secOn ? t("Enhanced security on") : t("Enhanced security off"));
      ctx.actions.renderRooms();
    } catch(e) { ctx.toast(t("Failed to save setting: {error}", { error: ctx.helpers.errorText(e) }), true); }
  });
  const secCovers = [
    t("Devices: merging, deleting, renaming and labelling them"),
    t("Calibration points and the calibration model"),
    t("The house layout: rooms, scanners, lights, beacons, walls, floor heights and map details"),
    t("Scanner offsets and turning radios off or marking them lost"),
    t("Follow alerts, phones added for tracking, and Find My links"),
    t("Clearing history, forgetting lost items and suspending learning"),
    t("Live Aboard edits, sharing to its library and its photo reader"),
    t("PadSpan's log"),
    t("Settings that apply to the whole home (the update check, positioning and the rest)"),
  ];
  put("privacy", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Enhanced security")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:8px;line-height:1.55" },
      t("When this is on, only a Home Assistant administrator can change how PadSpan is set up for this home. Everyone else in the household can still view and use PadSpan: the maps, Follow, lights, the emergency lighting test, the theme, the choices kept in their own browser (Map or 3D, what the Atlas shows, how much of the menu they see), and assigning a Bluetooth radio to a room. Display settings that change every screen in the home (Quiet mode, the Atlas as Overview, the Atlas layout and its showcase theme) need an admin while it is on. If they try to change something else, PadSpan tells them it needs an admin. More protections will be added here over time.")
    ),
    el("div", { style: "font-size:12px;color:#cbd5e1;margin-bottom:4px" }, t("What it covers now:")),
    el("ul", { style: "font-size:12px;color:#94a3b8;margin:0 0 12px 18px;padding:0;line-height:1.55" },
      secCovers.map(c => el("li", {}, c))),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Enhanced security")),
      secBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      secAdmin ? t("On for a new install; a home set up before November 2026 keeps it as it was. Takes effect at once, no restart needed.") : t("Only an administrator can change this.")
    ),
  ]));

  // ── Help improve PadSpan (opt-in usage report) ─────────────────────────────
  // OFF by default. The Preview shows the exact JSON that would go, before or
  // after opting in; the backend refuses to send anything identifier-shaped
  // regardless (telemetry.py assert_shareable).
  const telOn = !!settings.telemetry_enabled;
  // A free licence granted from 0.38.181 (trial, tester, free year) keeps the
  // report on until it ends (settings_store.report_locked_until; the backend
  // refuses too). The panel only sees whether that lock is set.
  const telLocked = telOn && !!settings.report_locked;
  const telBtn = el("button", { class: "btn inline", style: telOn
    ? "background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
    : "color:#94a3b8", title: telLocked ? t("On for your free trial") : "" }, telOn ? t("Opted in") : t("Not sharing"));
  if (telLocked) telBtn.disabled = true;
  telBtn.addEventListener("click", async () => {
    if (telLocked) return;
    // Off, on a key used on more than two homes: what that means, first.
    const offWarn = telOn ? reportOffConfirmText(settings) : "";
    if (offWarn && !confirm(offWarn)) return;
    try {
      await ctx.actions.settingsSet({ telemetry_enabled: !telOn });
      ctx.toast(!telOn ? t("Thank you — usage report on. Preview shows exactly what goes.") : t("Usage report off"));
      ctx.actions.renderRooms();
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  // Where they heard about PadSpan: their own answer, optional, sent as one
  // word with the report (telemetry.HEARD_WORDS; the opt-in card asks it once).
  const heardSel = el("select", { class: "select", style: "width:auto", "data-setting": "telemetry_heard" });
  for (const [v, lab] of [["", t("Not said")], ["reddit", "Reddit"], ["youtube", "YouTube"], ["ha_forum", t("Home Assistant forum")], ["forum", t("Another forum")],
                        ["marketplace", t("Marketplace or HACS")], ["github", "GitHub"], ["discord", "Discord"], ["search", t("A web search")],
                        ["friend", t("A friend")], ["other", t("Somewhere else")]]) heardSel.appendChild(el("option", { value: v }, lab));
  heardSel.value = String(settings.telemetry_heard || "");
  heardSel.addEventListener("change", async () => {
    try {
      await ctx.actions.settingsSet({ telemetry_heard: heardSel.value });
      ctx.toast(heardSel.value ? t("Thank you.") : t("Cleared: it is no longer sent."));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); heardSel.value = String(settings.telemetry_heard || ""); }
  });
  const telOut = el("pre", { class: "pre", style: "display:none;margin-top:10px;max-height:360px;overflow:auto;font-size:11px" });
  const telStatus = el("span", { class: "muted", style: "font-size:11px;margin-left:8px" }, "");
  const previewBtn = el("button", { class: "btn inline" }, t("Preview what would be sent"));
  previewBtn.addEventListener("click", async () => {
    previewBtn.disabled = true;
    try {
      const r = await ctx.actions.wsCall("padspan_ha/telemetry_preview");
      telOut.textContent = JSON.stringify(r.payload, null, 2);
      telOut.style.display = "block";
      telStatus.textContent = r.problem
        ? t("Would be REFUSED before sending: {problem}", { problem: r.problem })
        : t("{size} bytes → {url}", { size: JSON.stringify(r.payload).length, url: r.url });
      telStatus.style.color = r.problem ? "#f87171" : "";
    } catch(e) { ctx.toast(t("Preview failed: {error}", { error: ctx.helpers.errorText(e) }), true); }
    previewBtn.disabled = false;
  });
  const sendBtn = el("button", { class: "btn inline", disabled: telOn ? undefined : "disabled",
    title: telOn ? t("Send one report now") : t("Opt in first") }, t("Send a report now"));
  sendBtn.addEventListener("click", async () => {
    sendBtn.disabled = true;
    try {
      const r = await ctx.actions.wsCall("padspan_ha/telemetry_send_now");
      ctx.toast(r.sent ? t("Report sent ({size} bytes)", { size: r.bytes }) : t("Not sent: {reason}", { reason: r.reason || t("unknown") }), !r.sent);
    } catch(e) { ctx.toast(t("Send failed: {error}", { error: ctx.helpers.errorText(e) }), true); }
    sendBtn.disabled = false;
  });
  const idBtn = el("button", { class: "btn inline", title: t("Replace the anonymous install id with a new random one") }, t("New anonymous ID"));
  idBtn.addEventListener("click", async () => {
    idBtn.disabled = true;
    try {
      await ctx.actions.wsCall("padspan_ha/telemetry_reset_id");
      ctx.toast(t("New anonymous ID minted"));
      await ctx.actions.settingsSet({});   // reloads settings into ctx.state
    } catch(e) { ctx.toast(t("Failed: {error}", { error: ctx.helpers.errorText(e) }), true); }
    idBtn.disabled = false;
    ctx.actions.renderRooms();
  });
  // ── Suggest an idea ───────────────────────────────────────────────────────
  // GitHub Discussions → Ideas: where ideas are posted and voted on (a GitHub
  // account), or by email to hello@traks.ca for anyone without one. Not on a
  // wall screen, which could open a tab it can never close.
  if (newTabOk(ctx.state.kioskMode)) {
    const link = (href, label) => el("a", { class: "btn inline", href, target: "_blank", rel: "noopener", style: "text-decoration:none;font-size:13.333px;padding:7px 10px" }, label);
    const post = link(IDEAS_NEW_URL, t("Post an idea"));
    post.addEventListener("click", () => { if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("suggest_idea_posted"); });
    const browse = link(IDEAS_URL, t("See and vote on ideas"));
    browse.addEventListener("click", () => { if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("suggest_idea_browsed"); });
    const mail = link(IDEAS_MAIL, t("Email an idea"));
    mail.addEventListener("click", () => { if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("suggest_idea_mail"); });
    put("privacy", el("div", { class: "card" }, [
      el("div", { class: "h2" }, t("💡 Suggest an idea")),
      el("div", { class: "muted", style: "font-size:12px;margin-bottom:8px;line-height:1.55" },
        t("Something PadSpan should do, or do better? Post it where other people can vote on it, or vote on ideas already there. No GitHub account? Email it instead.")),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [
        post, browse, mail,
      ]),
    ]));
  }
  put("privacy", el("div", { class: "card", "data-focus-part": "usage_report" }, [
    el("div", { class: "h2" }, t("Help improve PadSpan")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:8px;line-height:1.55" },
      t("Opt in to send the developer an anonymous usage report at most once a day: which version and Home Assistant; the country and language set in Home Assistant (never looked up from your address); where you heard about PadSpan, if you chose to say; which store keeps PadSpan up to date (the Marketplace, HACS or neither); how many automations and scripts use it (two counts, never which); with a licence used on more than two homes, a short code made from the key (never the key) that is the same in each of that licence's homes, so they're seen together; how many scanners, floors, rooms, placed lights, walls, maps, calibration points, IRKs, irk-capture ESP32s and objects you have and which related integrations are installed; how your power teams are set up and how many colour bulbs of each brand you have, such as Hue or IKEA (words from a fixed list, never a name); which feature switches are on; which screen the Overview shows and any Overview settings changed from their defaults (as words, never numbers or names), and with two screens or more, a few words per screen (first five); how many minutes the busiest single screen showed PadSpan, all day and from 7 am to 11 pm (never which screen); with quiet mode on, roughly what share of objects it hides; which tabs and tools got used (and whether IRKs are resolving anything); a few health flags; how hard the machine works (load, Home Assistant's CPU and memory, sampled once a minute) and what class of machine it is (CPU count, RAM size, board); and how many warnings each part of the code logged. Counts, versions and flags only — never addresses, keys, device or room names, coordinates or timestamps. Preview is the complete list. PadSpan is developed against one house; this is how features that only exist in yours (an iPhone with an IRK, a Bermuda install, twelve floors) get seen at all. If you delete PadSpan while this is on, one last report says it was removed, and nothing else.")
    ),
    el("div", { class: "muted", style: "font-size:11px;margin-bottom:12px" },
      t("The report carries a random ID so installs can be counted rather than pings; you can replace it any time. Preview shows the exact JSON — what you see is what goes, and anything identifier-shaped is refused before it leaves. The developer may invite an install that reports to something, like a free year of Pro: the invite comes back with the report's reply and shows on Overview and under PadSpan licence. Nothing about you is sent unless you accept it.")),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Usage report")),
      telBtn,
      telStatus,
    ]),
    telLocked ? el("div", { class: "muted", style: "font-size:11px;margin:-2px 0 6px" },
      t("On while you use a free licence: it can't be turned off until it ends{until}, or with a bought key.", { until: settings.report_locked ? " (" + String(settings.report_locked).slice(0, 10) + ")" : "" })) : null,
    telOn ? el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Where you heard of PadSpan")),
      heardSel,
      el("span", { class: "muted", style: "font-size:11px" }, t("Optional. Your own answer, sent as one word.")),
    ]) : null,
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px" }, [previewBtn, sendBtn, idBtn]),
    telOut,
    // "Become a tester": its own section, consent and button, never part of
    // the report above (tester_signup.js). Offered while the report is on;
    // someone signed up can always see it and stop.
    testerSection(ctx, telOn),
  ]));

  // ── BLE Reseed Interval ──────────────────────────────────────────────────
  const aggressiveChk = el("input",{type:"checkbox"});
  aggressiveChk.checked = settings.aggressive_ble_reseed === true;
  aggressiveChk.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({aggressive_ble_reseed: aggressiveChk.checked});
      ctx.toast(aggressiveChk.checked ? t("Bluetooth refresh every 5 s on.") : t("Bluetooth refresh back to its interval."));
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast(t("Failed: {error}", { error: ctx.helpers.errorText(e) }), true); aggressiveChk.checked = !aggressiveChk.checked; }
  });
  const aggressiveReseedRow = el("div", { "data-setting": "aggressive_ble_reseed", style: "margin-top:10px" }, [
    el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px"},[
      aggressiveChk, el("span",{},t("Refresh every 5 s for passive proxy scanners")),
    ]),
    el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5;margin-top:4px"},
      t("Enable this if Shelly BLE proxies or other passive Bluetooth relay scanners aren't showing RSSI values during calibration. This keeps the refresh at 5 seconds or faster even if the interval below is set longer, working around a deduplication change in HA 2026.4.")),
    settings.aggressive_ble_reseed ? el("div",{style:"font-size:11px;color:#26c6da;margin-top:6px"},
      t("Active — reseeding from HA Bluetooth discovery every 5 seconds. This uses slightly more CPU but ensures Shelly and passive scanner data stays fresh.")) : null,
  ]);
  const currentReseed = (settings.ble_reseed_interval_s != null ? Number(settings.ble_reseed_interval_s) : 5);
  const reseedInp = el("input", {
    type: "number", min: "1", max: "60", step: "1", value: String(currentReseed), style: inpStyle,
  });
  const reseedSaveBtn = el("button", { class: "btn" }, t("Save"));
  reseedSaveBtn.addEventListener("click", async () => {
    const v = Math.max(1, Math.min(60, parseInt(reseedInp.value) || 5));
    try {
      await ctx.actions.settingsSet({ ble_reseed_interval_s: v });
      ctx.toast(t("Bluetooth refresh interval set to {seconds}s", { seconds: v }));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("receivers", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Bluetooth refresh interval")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("How often PadSpan re-fetches BLE data from HA's scanner infrastructure. Essential for passive proxy scanners (Shelly, ESPHome BLE proxy) whose advertisements don't arrive via callbacks. Lower values improve freshness on fast hardware.")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Refresh interval")),
      reseedInp,
      el("div", { class: "muted", style: "font-size:12px" }, t("seconds")),
      reseedSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      t("Current: {seconds}s. Default: 5s (every scanner's view at most one update old). Range: 1–60s.", { seconds: currentReseed })
    ),
    // "Aggressive BLE reseed" lived in Manage → HA Entities → BLE Proxy
    // Compatibility until 2026-10-30; it caps this interval at 5 s
    // (bluetooth_live.reseed_interval_s), so it lives beside it now and that
    // card links here.
    aggressiveReseedRow,
  ]));

  // ── Object History Retention ───────────────────────────────────────────────
  const HISTORY_DAY_CHOICES = [1, 2, 7, 14];
  const currentHistDays = (HISTORY_DAY_CHOICES.includes(Number(settings.object_history_days))
    ? Number(settings.object_history_days) : 1);
  const _unidentifiedNow = (((ctx.state.live && ctx.state.live.snapshot || {}).objects || {}).summary || {}).unidentified;
  const histSel = el("select", {
    style: "width:180px;background:#0a150e;color:#e2e8f0;border:1px solid #2d5a3d;border-radius:6px;padding:4px 8px;font-size:13px",
  });
  for (const d of HISTORY_DAY_CHOICES) {
    const o = el("option", { value: String(d) }, d === 1 ? t("1 day (default)") : tn(d, "{n} day", "{n} days"));
    if (d === currentHistDays) o.selected = true;
    histSel.appendChild(o);
  }
  const histSaveBtn = el("button", { class: "btn" }, t("Save"));
  histSaveBtn.addEventListener("click", async () => {
    const v = Number(histSel.value);
    if (!HISTORY_DAY_CHOICES.includes(v)) { ctx.toast(t("Invalid retention window"), true); return; }
    try {
      await ctx.actions.settingsSet({ object_history_days: v });
      ctx.toast(tn(v, "Object history set to {n} day", "Object history set to {n} days"));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("shown", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Object History Retention")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("How long a device that you never labelled is kept in history. Labelled and tagged devices are never removed, whatever this is set to. Every rotating-MAC device that passes by becomes a new entry, and the whole history is sent to this panel on every 5s refresh — so longer windows make the panel slower. Raise it only if you need to go back and label something you saw days ago.")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Keep unlabelled for")),
      histSel,
      histSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      tn(currentHistDays, "Current: {n} day. Default: 1 day.", "Current: {n} days. Default: 1 day.") + " " +
      (_unidentifiedNow != null ? t("Unlabelled devices in history right now: {count}.", { count: _unidentifiedNow }) + " " : "") +
      t("Lowering this takes effect on the next refresh; entries past the window are dropped.")
    ),
  ]));

  // ── Away timeout ───────────────────────────────────────────────────────────
  const currentAwayM = (settings.away_timeout_m != null ? Number(settings.away_timeout_m) : 5);
  const awayInp = el("input", {
    type: "number", min: "1", max: "1440", step: "1", value: String(currentAwayM), style: inpStyle,
  });
  const awaySaveBtn = el("button", { class: "btn" }, t("Save"));
  awaySaveBtn.addEventListener("click", async () => {
    const v = Math.max(1, Math.min(1440, parseFloat(awayInp.value) || 5));
    try {
      await ctx.actions.settingsSet({ away_timeout_m: v });
      ctx.toast(t("Away timeout set to {minutes} min", { minutes: v }));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  // An option, off (0) unless hours are set: things nobody carries keep their
  // last room that long (presence_rules.thing_away_timeout_s).
  const currentThingH = (settings.thing_away_timeout_h != null ? Number(settings.thing_away_timeout_h) : 0);
  const thingInp = el("input", {
    type: "number", min: "0", max: "48", step: "0.5", value: String(currentThingH), style: inpStyle,
  });
  const thingSaveBtn = el("button", { class: "btn" }, t("Save"));
  thingSaveBtn.addEventListener("click", async () => {
    const raw = parseFloat(thingInp.value);
    const v = Number.isFinite(raw) ? (raw <= 0 ? 0 : Math.max(0.5, Math.min(48, raw))) : 0;
    try {
      await ctx.actions.settingsSet({ thing_away_timeout_h: v });
      ctx.toast(v === 0 ? t("Off: everything goes away after the away timeout") : t("Things keep their room for {hours} h", { hours: v }));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("rooms", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Home/Away Timeout")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("If a device hasn't been detected for this long, it is marked as not_home in HA. The device_tracker and area sensor both switch to not_home. Set higher if devices drop off briefly during normal use.")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Away timeout")),
      awayInp,
      el("div", { class: "muted", style: "font-size:12px" }, t("minutes")),
      awaySaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      t("Current: {minutes} min ({seconds}s). Default: 5 min. Range: 1 min – 24 h.", { minutes: currentAwayM, seconds: currentAwayM * 60 })
    ),
    el("div", { class: "muted", style: "font-size:12px;margin:16px 0 14px" },
      t("Optional, and off to start with. For keys in a drawer, a tag on a bag and other things nobody carries: set a number of hours and they stay in the room they were last seen in for that long, then switch to not_home. What a person carries still goes away after the away timeout above. A device counts as carried when it is added to a person in Home Assistant (Settings → People → Track devices), is picked for them in Live Aboard (Furnish → People & devices), or has the person's name. Every other named device counts as a thing. So before you turn this on, add each phone and watch to its person, or it reads as home in its last room for these hours after it has left. A car's tag does the same: it stays in the garage for these hours after the car has gone. 0 = off: everything goes away after the away timeout.")
    ),
    el("div", { style: rowStyle, "data-thing-away": "" }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Things keep their room")),
      thingInp,
      el("div", { class: "muted", style: "font-size:12px" }, t("hours")),
      thingSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      t("Current: {value}. Default: off (0). Range: 0.5 – 48 h.", { value: currentThingH === 0 ? t("off (same as the away timeout)") : currentThingH + " h" })
    ),
  ]));

  // (A "Signal Loss Linger" card stood here. Its setting has done nothing
  // since 0.20.16, when the linger logic was removed for a fixed 120 s grace
  // (presence_coordinator._AWAY_GRACE_S) — the card was left behind, so a
  // linger time could be set and changed nothing. The backend still accepts
  // the key, so an older settings file stays valid.)

  // ── BLE Advertisement Timeout ─────────────────────────────────────────────
  // Unset means 14400 s: what the backend has always used (low_memory.py).
  const currentBleAge = (settings.ble_max_age_s != null ? Number(settings.ble_max_age_s) : 14400);
  const bleAgeInp = el("input", {
    type: "number", min: "60", max: "14400", step: "60", value: String(currentBleAge), style: inpStyle,
  });
  const bleAgeSaveBtn = el("button", { class: "btn" }, t("Save"));
  bleAgeSaveBtn.addEventListener("click", async () => {
    const v = Math.max(60, Math.min(14400, parseInt(bleAgeInp.value) || 14400));
    try {
      await ctx.actions.settingsSet({ ble_max_age_s: v });
      ctx.toast(t("BLE timeout set to {seconds}s", { seconds: v }));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("shown", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("BLE Advertisement Timeout")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("How long to keep a BLE device visible after its last advertisement. Higher values show more devices (especially slow-broadcasting ones). Lower values keep the list cleaner but may drop intermittent devices.")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Max age")),
      bleAgeInp,
      el("div", { class: "muted", style: "font-size:12px" }, t("seconds")),
      bleAgeSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      t("Current: {seconds}s. Default: 14400s (4 h). Range: 60s – 14400s (4 h).", { seconds: currentBleAge }) +
      (settings.low_memory_mode ? " " + t("Low-memory mode holds it to 900s (15 min).") : "")
    ),
  ]));

  // ── Private BLE / IRK Management ─────────────────────────────────────────
  {
    const irkCard = el("div", { class: "card" });
    irkCard.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:4px" }, [
      el("div", { class: "h2", style: "margin:0" }, t("Phone Tracking (Private BLE)")),
      helpBtn("private_ble"),
    ]));
    irkCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("Track phones and watches with rotating MAC addresses using their IRK (Identity Resolving Key). PadSpan scans system Bluetooth bonds automatically, or you can paste an IRK manually.")
    ));

    // ── Auto-Detect section ──────────────────────────────────────────────
    const autoDetectRow = el("div", { style: "margin-bottom:14px" });
    const autoBtn = el("button", { class: "btn", style: "margin-right:8px" }, t("Auto-Detect IRKs"));
    const autoMsg = el("span", { style: "font-size:12px;color:#94a3b8" });
    autoDetectRow.appendChild(autoBtn);
    autoDetectRow.appendChild(autoMsg);
    const autoResults = el("div", { style: "margin-top:8px" });
    autoDetectRow.appendChild(autoResults);

    autoBtn.addEventListener("click", async () => {
      autoBtn.disabled = true;
      autoBtn.textContent = t("Scanning...");
      autoMsg.textContent = "";
      autoResults.innerHTML = "";
      try {
        const res = await ctx.actions.wsCall("padspan_ha/irk_auto_detect", {});
        const found = res.found || [];
        const newOnes = found.filter(f => !f.already_registered);
        if (!found.length) {
          autoMsg.style.color = "#94a3b8";
          autoMsg.textContent = t("No IRKs found in system Bluetooth bonds. Pair your phone via Bluetooth first, or paste the IRK manually below.");
        } else if (!newOnes.length) {
          autoMsg.style.color = "#52b788";
          autoMsg.textContent = tn(found.length, "The bonded device is already registered.", "All {n} bonded devices are already registered.");
        } else {
          autoMsg.style.color = "#fbbf24";
          autoMsg.textContent = tn(newOnes.length, "{n} new IRK found!", "{n} new IRKs found!") + " " + (res.rpa_count > 0 ? t("Verifying against live BLE...") : "");
          // Show each found IRK with an "Add" button
          for (const item of newOnes) {
            const row = el("div", { style: "display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #1b3526" });
            const badge = el("span", { style: "font-size:10px;padding:1px 6px;border-radius:3px;font-weight:600;" +
              (item.verified ? "background:#052e16;color:#52b788;border:1px solid #2d6a4f" : "background:#1a0d00;color:#fbbf24;border:1px solid #92400e") },
              item.verified ? t("Verified") : t("Unverified"));
            const nameLbl = el("span", { style: "font-weight:600;color:#e2e8f0;font-size:13px" }, item.name || item.device_mac || t("Unknown"));
            const srcLbl = el("span", { style: "font-size:11px;color:#64748b" }, item.source === "bluetooth_bond" ? t("System BT bond") : item.source);
            const matchLbl = el("span", { style: "font-size:11px;color:#94a3b8" },
              item.matched_count > 0 ? tn(item.matched_count, "{n} RPA match", "{n} RPA matches") : "");
            const addIrkBtn = el("button", { class: "btn inline", style: "margin-left:auto;font-size:11px;padding:2px 10px" }, t("Add"));
            addIrkBtn.addEventListener("click", async () => {
              addIrkBtn.disabled = true;
              addIrkBtn.textContent = t("Adding...");
              try {
                await ctx.actions.wsCall("padspan_ha/private_ble_add_irk", { irk: item.irk_hex, name: item.name || "Phone" });
                addIrkBtn.textContent = t("Added");
                addIrkBtn.style.color = "#52b788";
                await _refreshIrkStatus();
              } catch(e) {
                addIrkBtn.textContent = t("Error");
                addIrkBtn.style.color = "#f87171";
                addIrkBtn.title = e.message || String(e);
                setTimeout(() => { addIrkBtn.textContent = t("Add"); addIrkBtn.disabled = false; addIrkBtn.style.color = ""; }, 3000);
              }
            });
            row.appendChild(badge);
            row.appendChild(nameLbl);
            row.appendChild(srcLbl);
            row.appendChild(matchLbl);
            row.appendChild(addIrkBtn);
            autoResults.appendChild(row);
          }
        }
      } catch(e) {
        autoMsg.style.color = "#f87171";
        autoMsg.textContent = t("Auto-detect failed: {error}", { error: e.message || String(e) });
      }
      autoBtn.disabled = false;
      autoBtn.textContent = t("Auto-Detect IRKs");
    });
    irkCard.appendChild(autoDetectRow);

    // Status: load current IRKs
    const irkStatus = el("div", { style: "margin-bottom:12px" });
    irkStatus.textContent = t("Loading...");
    async function _refreshIrkStatus() {
      try {
        const st = await ctx.actions.wsCall("padspan_ha/private_ble_status", {});
        const devices = st.devices || [];
        const sourceInfo = st.source_info || [];
        const rpas = st.rpa_count || 0;
        if (devices.length) {
          irkStatus.innerHTML = "";
          const tbl = el("table", { class: "table", style: "font-size:12px;margin-bottom:8px" });
          const thead = el("thead", {}, el("tr", {}, [el("th",{},t("Name")), el("th",{},t("Canonical ID")), el("th",{},t("Source")), el("th",{},"")]));
          tbl.appendChild(thead);
          const tbody = el("tbody", {});
          for (const d of devices) {
            const shortId = (d.canonical_id || "").replace(/^irk:/, "").substring(0, 12) + "...";
            const delBtn = el("button", {
              class: "btn inline",
              style: "font-size:10px;padding:1px 6px;color:#f87171;border-color:#5c2020;background:none",
            }, t("Delete from HA"));
            if (d.entry_id) {
              delBtn.addEventListener("click", async () => {
                if (!confirm(t("Delete \"{name}\" from Home Assistant? This removes the Private BLE Device integration entry itself — the device disappears from HA, not just from PadSpan.", { name: d.name || t("device") }))) return;
                if (!confirm(t("Are you sure? \"{name}\" will be deleted from Home Assistant. You would need its IRK to re-add it.", { name: d.name || t("device") }))) return;
                delBtn.disabled = true;
                delBtn.textContent = "...";
                try {
                  await ctx.actions.wsCall("padspan_ha/private_ble_delete_irk", { entry_id: d.entry_id });
                  await _refreshIrkStatus();
                } catch(e) {
                  delBtn.textContent = t("Error");
                  setTimeout(() => { delBtn.textContent = t("Delete"); delBtn.disabled = false; }, 2000);
                }
              });
            } else {
              delBtn.disabled = true;
              delBtn.title = t("Managed by HA — delete from Settings → Devices & Services");
            }
            tbody.appendChild(el("tr", {}, [
              el("td", {}, d.name || "—"),
              el("td", { class: "muted", style: "font-family:monospace;font-size:11px" }, shortId),
              el("td", { class: "muted" }, d.source || "private_ble_device"),
              el("td", {}, delBtn),
            ]));
          }
          tbl.appendChild(tbody);
          irkStatus.appendChild(tbl);
          irkStatus.appendChild(el("div", { class: "muted", style: "font-size:11px" },
            tn(devices.length, "{n} IRK registered", "{n} IRKs registered") + (rpas > 0 ? " · " + tn(rpas, "{n} rotating address detected", "{n} rotating addresses detected") : "")));
        } else {
          irkStatus.innerHTML = "";
          irkStatus.appendChild(el("div", { style: "color:#fbbf24;font-size:12px;margin-bottom:4px" },
            rpas > 0
              ? tn(rpas, "No IRKs registered yet — {n} rotating MAC address detected. Add IRKs below to track phones.", "No IRKs registered yet — {n} rotating MAC addresses detected. Add IRKs below to track phones.")
              : t("No IRKs registered and no rotating addresses detected.")
          ));
        }
      } catch(e) {
        irkStatus.textContent = t("Could not load status");
      }
    }
    _refreshIrkStatus();
    irkCard.appendChild(irkStatus);

    // Add IRK form
    const irkInp = el("input", {
      type: "text", placeholder: t("Paste IRK (hex or base64)"),
      style: "flex:1;min-width:200px;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:13px;font-family:monospace",
    });
    const nameInp = el("input", {
      type: "text", placeholder: t("Device name (e.g., Alice's iPhone)"),
      style: "flex:1;min-width:160px;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:13px",
    });
    const addBtn = el("button", { class: "btn" }, t("Add IRK"));
    // Progress bar container — hidden until validation starts
    const irkProgress = el("div", { style: "display:none;margin-top:6px" });
    const irkMsg = el("div", { style: "font-size:11px;margin-top:6px;min-height:16px" });
    // Override row — shown when validation finds no match
    const irkOverrideRow = el("div", { style: "display:none;margin-top:6px;display:none;align-items:center;gap:8px" });

    // Helper: commit the IRK to HA (shared by both validated and override paths)
    const _commitIrk = async (irk, name) => {
      try {
        const res = await ctx.actions.wsCall("padspan_ha/private_ble_add_irk", { irk, name: name || "PadSpan Device" });
        if (res.duplicate) {
          irkMsg.style.color = "#fbbf24";
          irkMsg.textContent = res.message || t("Already registered");
        } else {
          irkMsg.style.color = "#52b788";
          irkMsg.textContent = res.message || t("IRK added successfully");
          irkInp.value = "";
          nameInp.value = "";
        }
        await _refreshIrkStatus();
      } catch(e) {
        irkMsg.style.color = "#f87171";
        irkMsg.textContent = e.message || t("Failed to add IRK");
      }
    };

    // ── Validation-then-add flow ──
    // Polls irk_validate every 5s for up to 30s, looking for a live RPA match.
    // If matched: auto-saves. If not: shows warning + "Save Anyway" override.
    let _validationAborted = false;

    addBtn.addEventListener("click", async () => {
      const irk = irkInp.value.trim();
      const name = nameInp.value.trim();
      if (!irk) { irkMsg.textContent = t("Please paste an IRK"); irkMsg.style.color = "#f87171"; return; }

      // Reset UI state
      addBtn.disabled = true;
      addBtn.textContent = t("Validating...");
      irkMsg.textContent = "";
      irkOverrideRow.style.display = "none";
      _validationAborted = false;

      // Build progress bar
      const VALIDATE_DURATION_S = 30;
      const POLL_INTERVAL_S = 5;
      irkProgress.style.display = "block";
      irkProgress.innerHTML = "";
      const progressLabel = el("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:3px" }, t("Scanning for device..."));
      const barOuter = el("div", { style: "height:6px;border-radius:3px;background:#1a2a1a;overflow:hidden;position:relative" });
      const barInner = el("div", { style: "height:100%;width:0%;background:#52b788;border-radius:3px;transition:width 0.4s ease" });
      barOuter.appendChild(barInner);
      irkProgress.appendChild(progressLabel);
      irkProgress.appendChild(barOuter);

      // Cancel button inside progress area
      const cancelBtn = el("button", { class: "btn inline", style: "font-size:10px;margin-top:4px;padding:2px 10px;color:#f87171;border-color:#7f1d1d" }, t("Cancel"));
      cancelBtn.addEventListener("click", () => { _validationAborted = true; });
      irkProgress.appendChild(cancelBtn);

      // Poll loop: try irk_validate every POLL_INTERVAL_S up to VALIDATE_DURATION_S
      let matched = false;
      let lastResult = null;
      const rounds = Math.ceil(VALIDATE_DURATION_S / POLL_INTERVAL_S);
      for (let i = 0; i < rounds; i++) {
        if (_validationAborted) break;
        const elapsed = i * POLL_INTERVAL_S;
        const pct = Math.min(100, Math.round((elapsed / VALIDATE_DURATION_S) * 100));
        barInner.style.width = pct + "%";
        progressLabel.textContent = t("Scanning for device... {elapsed}s / {total}s", { elapsed, total: VALIDATE_DURATION_S });

        try {
          lastResult = await ctx.actions.wsCall("padspan_ha/irk_validate", { irk_hex: irk });
          if (lastResult && lastResult.matched_count > 0) {
            matched = true;
            break;
          }
        } catch(e) {
          // Parse error — key is malformed
          irkMsg.style.color = "#f87171";
          irkMsg.textContent = e.message || t("Invalid IRK format");
          irkProgress.style.display = "none";
          addBtn.disabled = false;
          addBtn.textContent = t("Add IRK");
          return;
        }

        // Wait before next poll (unless it's the last round)
        if (i < rounds - 1 && !_validationAborted) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL_S * 1000));
        }
      }

      // Fill bar to 100%
      barInner.style.width = "100%";

      if (_validationAborted) {
        // User cancelled
        irkProgress.style.display = "none";
        irkMsg.style.color = "#94a3b8";
        irkMsg.textContent = t("Validation cancelled.");
        addBtn.disabled = false;
        addBtn.textContent = t("Add IRK");
        return;
      }

      irkProgress.style.display = "none";

      if (matched) {
        // Key verified — save using the exact hex that matched
        const n = lastResult.matched_count;
        const validatedHex = lastResult.irk_hex || irk;
        progressLabel.textContent = "";
        irkMsg.style.color = "#52b788";
        const fmtNote = lastResult.matched_format ? " " + t("(format: {format})", { format: lastResult.matched_format }) : "";
        irkMsg.textContent = tn(n, "Verified — matched {n} rotating address{note}. Saving...", "Verified — matched {n} rotating addresses{note}. Saving...", { note: fmtNote });
        await _commitIrk(validatedHex, name);
        addBtn.disabled = false;
        addBtn.textContent = t("Add IRK");
      } else {
        // No match — warn + offer override
        const rpas = lastResult ? lastResult.rpa_count : 0;
        irkMsg.style.color = "#fbbf24";
        irkMsg.textContent = rpas > 0
          ? t("No match found after {seconds}s ({count} rotating addresses scanned). The device may be off, out of range, or the key may be incorrect.", { seconds: VALIDATE_DURATION_S, count: rpas })
          : t("No rotating addresses detected. Make sure BLE scanners are online and the device is nearby.");

        // Show override buttons
        irkOverrideRow.style.display = "flex";
        irkOverrideRow.innerHTML = "";
        const saveAnywayBtn = el("button", { class: "btn", style: "font-size:11px;background:#1a0d00;border-color:#d97706;color:#fbbf24" }, t("Save Anyway"));
        const retryBtn = el("button", { class: "btn inline", style: "font-size:11px" }, t("Retry"));
        const cancelBtn2 = el("button", { class: "btn inline", style: "font-size:11px;color:#94a3b8" }, t("Cancel"));

        saveAnywayBtn.addEventListener("click", async () => {
          irkOverrideRow.style.display = "none";
          addBtn.disabled = true;
          addBtn.textContent = t("Saving...");
          irkMsg.textContent = "";
          await _commitIrk(irk, name);
          addBtn.disabled = false;
          addBtn.textContent = t("Add IRK");
        });
        retryBtn.addEventListener("click", () => {
          irkOverrideRow.style.display = "none";
          irkMsg.textContent = "";
          addBtn.disabled = false;
          addBtn.textContent = t("Add IRK");
          addBtn.click();  // re-trigger validation
        });
        cancelBtn2.addEventListener("click", () => {
          irkOverrideRow.style.display = "none";
          irkMsg.textContent = "";
          addBtn.disabled = false;
          addBtn.textContent = t("Add IRK");
        });

        irkOverrideRow.appendChild(saveAnywayBtn);
        irkOverrideRow.appendChild(retryBtn);
        irkOverrideRow.appendChild(cancelBtn2);
        addBtn.disabled = false;
        addBtn.textContent = t("Add IRK");
      }
    });

    irkCard.appendChild(el("div", { style: rowStyle }, [irkInp]));
    irkCard.appendChild(el("div", { style: rowStyle + ";margin-top:4px" }, [nameInp, addBtn]));
    irkCard.appendChild(irkProgress);
    irkCard.appendChild(irkMsg);
    irkCard.appendChild(irkOverrideRow);

    // Brief help
    irkCard.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:12px;line-height:1.6" },
      t("Paste your device's IRK above and PadSpan handles the rest. Important: the device must be actively broadcasting (awake, Bluetooth on) and in range of a scanner when adding its IRK. Click below for step-by-step instructions for every device type.")
    ));

    // Detailed guide toggle
    const guideBtn = el("button", { class: "btn inline", style: "margin-top:8px;font-size:12px;color:#60a5fa;border-color:#1e4976" }, t("Detailed Setup Guide"));
    const guidePanel = el("div", { style: "display:none;margin-top:12px;border:1px solid #1e3a2a;border-radius:8px;padding:14px;background:#060d08;line-height:1.7;font-size:12px;color:#cbd5e1" });
    guideBtn.addEventListener("click", () => {
      const open = guidePanel.style.display !== "none";
      guidePanel.style.display = open ? "none" : "block";
      guideBtn.textContent = open ? t("Detailed Setup Guide") : t("Hide Guide");
    });
    irkCard.appendChild(guideBtn);

    // i18n part: -
    // i18n part: tracking2
    const md = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");   // the guide's bold, kept out of the words
    guidePanel.innerHTML = `
<div style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:10px">${t("What is an IRK and why do you need it?")}</div>
<p style="margin:0 0 10px">
  ${md(t("Modern phones, watches, and tablets use **BLE Privacy** — they constantly rotate their Bluetooth MAC address (called a **Random Private Address** or **RPA**) every ~15 minutes to prevent tracking. This means a single phone looks like dozens of different devices to your BLE scanners."))}
</p>
<p style="margin:0 0 10px">
  ${md(t("The **IRK (Identity Resolving Key)** is a secret 128-bit key stored on the device. Anyone who knows the IRK can mathematically verify that a rotating MAC belongs to that specific device. By giving PadSpan your device's IRK, it can resolve all those rotating addresses back to one identity — enabling reliable room-level tracking."))}
</p>
<p style="margin:0 0 16px">
  ${md(t("PadSpan uses Home Assistant's **Private BLE Device** integration under the hood. You just paste the IRK here and PadSpan creates the integration entry automatically — no manual HA configuration needed."))}
</p>

<div style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:8px;border-top:1px solid #1e3a2a;padding-top:12px">
  ${t("Getting the IRK: By Device Type")}
</div>

<!-- ── iPhone / iPad ── -->
<div style="margin-bottom:16px">
  <div style="font-weight:700;color:#60a5fa;font-size:13px;margin-bottom:4px">Apple iPhone / iPad / Apple Watch</div>
  <p style="margin:0 0 6px">${md(t("Apple does NOT expose the IRK in iOS settings. You need a **Mac** signed into the **same iCloud account**."))}</p>
  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">${t("Method 1: Mac Keychain Access (recommended)")}</div>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>${md(t("On your Mac, open **Keychain Access** (search in Spotlight)."))}</li>
    <li>${md(t("In the top menu, select **Keychain Access → Preferences → Show Keychain Status in Menu Bar** (if needed)."))}</li>
    <li>${md(t("Ensure you're viewing the **iCloud** or **login** keychain (sidebar)."))}</li>
    <li>${md(t("In the search bar, type **BluetoothLE** or **GattServer**."))}</li>
    <li>${t("Look for entries like {c1} or similar.", { c1: "<code style=\"background:#1a2a1a;padding:1px 4px;border-radius:3px\">com.apple.bluetooth.\u2026LTK</code>" })}</li>
    <li>${md(t("Double-click each entry → click **Show password** (enter your Mac password)."))}</li>
    <li>${md(t("The data contains a **plist** or binary blob. Look for a 16-byte (32 hex character) value labeled **IRK** or **IdentityResolvingKey**."))}</li>
    <li>${t("Copy the 32-character hex string and paste it above.")}</li>
  </ol>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">${t("Method 2: macOS Terminal (faster if you know your way around)")}</div>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>${md(t("Open **Terminal** on your Mac."))}</li>
    <li>${t("Run:")} <code style="background:#1a2a1a;padding:2px 6px;border-radius:3px;display:inline-block;margin:2px 0">
      sudo defaults read /private/var/root/Library/Preferences/com.apple.bluetoothd.plist</code></li>
    <li>${t("Enter your admin password.")}</li>
    <li>${md(t("Search the output for your iPhone/iPad/Watch name. Under its entry, find the **IRK** field."))}</li>
    <li>${md(t("The IRK will be shown as a **base64** string (e.g., {c1}) or as hex data inside angle brackets ({c2}).", { c1: "<code style=\"background:#1a2a1a;padding:1px 4px;border-radius:3px\">aBcDeFgHiJkLmNoPqRsTuA==</code>", c2: "<code style=\"background:#1a2a1a;padding:1px 4px;border-radius:3px\">&lt;a1b2c3d4 e5f6a7b8\u2026&gt;</code>" }))}</li>
    <li>${t("Paste either format — PadSpan accepts both hex and base64.")}</li>
  </ol>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">${t("Method 3: ESP32 BLE IRK Sniffer")}</div>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>${t("If you don't have a Mac, use an ESP32 running a BLE bond/pairing sketch.")}</li>
    <li>${md(t("Flash the ESP32 with a BLE pairing firmware (search for **\"ESP32 IRK capture\"** — several open-source tools exist)."))}</li>
    <li>${t("Put your phone in Bluetooth pairing mode and pair it with the ESP32.")}</li>
    <li>${t("After pairing completes, the ESP32 serial output shows the exchanged keys including the IRK.")}</li>
    <li>${t("Copy the 32-hex-character IRK and paste it above.")}</li>
  </ol>

  <div style="background:#1a1a0a;border:1px solid #92400e;border-radius:6px;padding:8px 10px;margin-top:4px">
    <div style="font-weight:600;color:#fbbf24;font-size:11px;margin-bottom:2px">${t("Apple Watch Note")}</div>
    <div style="font-size:11px;color:#d4d4aa">
      ${t("Apple Watch has its own separate IRK (different from the paired iPhone). You need to find and add it separately. Look for the Watch's Bluetooth name in the Keychain/plist data. Each Watch will appear as a separate device.")}
    </div>
  </div>
</div>

<!-- ── Android ── -->
<div style="margin-bottom:16px">
  <div style="font-weight:700;color:#4ade80;font-size:13px;margin-bottom:4px">${t("Android Phones / Tablets")}</div>

  <div style="background:#0a1a2a;border:1px solid #2563eb;border-radius:6px;padding:8px 10px;margin-bottom:10px">
    <div style="font-weight:600;color:#60a5fa;font-size:11px;margin-bottom:2px">${t("Do you need an IRK for Android?")}</div>
    <div style="font-size:11px;color:#a5c8d4">
      ${md(t("If the HA Companion App's **BLE Transmitter** sensor is enabled, your phone already broadcasts an **iBeacon signal** that PadSpan tracks automatically — no IRK needed. Check the **Overview → Track My Phone** section: if your phone shows as \"visible\" or \"BLE active\", it's already being tracked. IRK adds enhanced tracking when iBeacon is not broadcasting (screen off for extended periods, app killed, etc.)."))}
    </div>
  </div>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">${t("Method 1: HA Private BLE Device Integration (recommended)")}</div>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>${md(t("In Home Assistant, go to **Settings → Devices & Services → Add Integration**."))}</li>
    <li>${md(t("Search for **\"Private BLE Device\"** and add it."))}</li>
    <li>${t("HA will scan for nearby BLE devices with rotating addresses and offer to add them.")}</li>
    <li>${t("Select your phone from the list — HA handles the IRK extraction automatically.")}</li>
    <li>${t("PadSpan picks up the IRK from this integration within 60 seconds.")}</li>
  </ol>
  <div style="background:#0a1a1a;border:1px solid #164e63;border-radius:6px;padding:8px 10px;margin-bottom:8px">
    <div style="font-weight:600;color:#22d3ee;font-size:11px;margin-bottom:2px">${t("Important: BLE Transmitter should be enabled")}</div>
    <div style="font-size:11px;color:#a5c8d4">
      ${md(t("Enable the HA Companion App's **BLE Transmitter** sensor for the best tracking coverage. This makes Android broadcast a consistent iBeacon identity that PadSpan tracks natively. Battery impact is minimal (~1-2%)."))}
    </div>
  </div>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">${t("Method 2: ADB / Root Access (advanced)")}</div>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>${t("On a rooted Android device (or via ADB with root):")} <code style="background:#1a2a1a;padding:2px 6px;border-radius:3px;display:inline-block;margin:2px 0">
      adb shell su -c "cat /data/misc/bluedroid/bt_config.conf"</code></li>
    <li>${md(t("Find the **[Local]** section → look for **LE_LOCAL_KEY_IRK**."))}</li>
    <li>${t("The value is your IRK in hex. Copy and paste above.")}</li>
  </ol>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">${t("Method 3: ESP32 Pairing (same as iPhone method)")}</div>
  <p style="margin:0 0 8px;padding-left:20px">${t("Pair the Android phone with an ESP32 running BLE pairing firmware. The IRK is exchanged during pairing and shown in the serial output.")}</p>
</div>

<!-- ── Wear OS / Samsung Galaxy Watch ── -->
<div style="margin-bottom:16px">
  <div style="font-weight:700;color:#c4b5fd;font-size:13px;margin-bottom:4px">Wear OS / Samsung Galaxy Watch</div>
  <p style="margin:0 0 6px">${t("Smart watches have their own BLE identity, separate from the phone they're paired with.")}</p>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>${md(t("If the watch runs **Wear OS** and has the **HA Companion App** installed, use the same BLE Transmitter method as Android above."))}</li>
    <li>${md(t("For **Samsung Galaxy Watch** without HA app: Use the ESP32 pairing method. Put the watch in pairing mode and pair with the ESP32."))}</li>
    <li>${t("Alternatively, on the paired phone, the watch's IRK may be stored in the Bluetooth bond data:")}
      <code style="background:#1a2a1a;padding:2px 6px;border-radius:3px;display:inline-block;margin:2px 0">
      adb shell su -c "cat /data/misc/bluedroid/bt_config.conf"</code>
      ${md(t("— look for the watch's MAC under **[Bonded Devices]** section."))}</li>
  </ol>
</div>

<!-- ── BLE Tags / Trackers ── -->
<div style="margin-bottom:16px">
  <div style="font-weight:700;color:#fb923c;font-size:13px;margin-bottom:4px">${t("BLE Tags & Trackers (Tile, AirTag, SmartTag, Chipolo, etc.)")}</div>

  <div style="background:#1a1a0a;border:1px solid #92400e;border-radius:6px;padding:8px 10px;margin-bottom:8px">
    <div style="font-weight:600;color:#fbbf24;font-size:11px;margin-bottom:2px">${t("Do you actually need an IRK for tags?")}</div>
    <div style="font-size:11px;color:#d4d4aa">
      ${md(t("Many BLE tags use **iBeacon** or fixed MAC addresses — PadSpan already tracks these natively without needing an IRK. Check the **Devices** screen: if your tag shows up as an \"iBeacon\" or \"BLE\" object with a consistent address, you're already set. IRKs are only needed for tags that use **rotating random MACs**."))}
    </div>
  </div>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">${t("Apple AirTag and other Find My tags")}</div>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li>${md(t("AirTags and tags sold as \"works with Apple Find My\" change their Bluetooth address every 15 minutes near their owner's iPhone, and once a day (at about 4 am) when away from it. Nothing else in what they send stays the same, and they have **no IRK** — so neither an IRK nor iBeacon grouping can follow them."))}</li>
    <li>${md(t("PadSpan recognises them (the **Find My** badge) and, with **Settings → Features → MAC Rotation Bridging** on, carries a tag you've named or followed onto its next address when it's clear which one it is: the same kind of tag, the old address has stopped, and your scanners hear the new one in the same place. Its name, room and Follow carry on."))}</li>
    <li>${t("It won't guess. Two tags lying together that change at the same moment stay unlinked — give the new one its name again. A tag that was out of range when it changed is a new object too.")}</li>
    <li>${t("For a tag that never changes, use an iBeacon tag or the Home Assistant Companion app's iBeacon.")}</li>
  </ul>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">Samsung SmartTag / SmartTag2</div>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li>${t("SmartTags use Samsung's SmartThings Find network and rotate MACs.")}</li>
    <li>${md(t("They often broadcast a fixed **service UUID** that PadSpan can group via dedup."))}</li>
    <li>${t("For IRK extraction: pair the SmartTag with an ESP32, or extract from the SmartThings app data on a rooted phone.")}</li>
  </ul>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">${t("Tile Trackers")}</div>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li>${md(t("Tile trackers typically use a **fixed public MAC** — PadSpan tracks them directly without an IRK."))}</li>
    <li>${t("If your Tile uses a rotating MAC (newer models), the IRK can be extracted via ESP32 pairing.")}</li>
  </ul>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">${t("Chipolo, Nutfind, and Other Tags")}</div>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li>${t("Most use fixed MACs or iBeacon — check Devices → By Room first.")}</li>
    <li>${t("If rotating: pair with ESP32 to extract IRK.")}</li>
  </ul>
</div>

<!-- ── Laptops / Bluetooth Headphones ── -->
<div style="margin-bottom:16px">
  <div style="font-weight:700;color:#f472b6;font-size:13px;margin-bottom:4px">${t("Laptops, Headphones & Other BLE Devices")}</div>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li>${md(t("**Windows laptops**: Usually use a fixed public MAC for Bluetooth. Check Devices → By Room — if it appears with a consistent address, no IRK needed."))}</li>
    <li>${md(t("**Mac laptops**: Use BLE privacy with rotating MACs. Extract IRK from the macOS Bluetooth plist (same Terminal method as iPhone above, look for the Mac's own entry)."))}</li>
    <li>${md(t("**Bluetooth headphones/earbuds**: Most use a **fixed MAC** when actively connected/broadcasting. No IRK needed — PadSpan tracks them directly."))}</li>
    <li>${md(t("**Fitness bands**: Varies by manufacturer. Check Devices → By Room first. If rotating MAC, try ESP32 pairing method."))}</li>
  </ul>
</div>

<!-- ── IRK Format ── -->
<div style="margin-bottom:16px;border-top:1px solid #1e3a2a;padding-top:12px">
  <div style="font-weight:700;color:#e2e8f0;font-size:13px;margin-bottom:6px">${t("IRK Format")}</div>
  <p style="margin:0 0 6px">${t("PadSpan accepts IRKs in two formats — paste either one:")}</p>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li>${md(t("**Hex**: 32 hexadecimal characters (e.g., {c1})", { c1: "<code style=\"background:#1a2a1a;padding:1px 4px;border-radius:3px\">a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6</code>" }))}</li>
    <li>${md(t("**Base64**: 24 characters ending in {c1} or {c2} (e.g., {c3})", { c1: "<code style=\"background:#1a2a1a;padding:1px 4px;border-radius:3px\">=</code>", c2: "<code style=\"background:#1a2a1a;padding:1px 4px;border-radius:3px\">==</code>", c3: "<code style=\"background:#1a2a1a;padding:1px 4px;border-radius:3px\">obLD1OX2p7jJ0OHyo7TF1g==</code>" }))}</li>
  </ul>
  <p style="margin:0 0 6px">${t("Both represent the same 16-byte (128-bit) key. Hex is more common from Android; base64 from macOS.")}</p>
  <p style="margin:0">
    ${md(t("**Spaces, colons, and dashes are stripped automatically** — so formats like {c1} or {c2} also work.", { c1: "<code style=\"background:#1a2a1a;padding:1px 4px;border-radius:3px\">a1:b2:c3:d4:\u2026</code>", c2: "<code style=\"background:#1a2a1a;padding:1px 4px;border-radius:3px\">a1 b2 c3 d4 \u2026</code>" }))}
  </p>
</div>

<!-- ── Troubleshooting ── -->
<div style="margin-bottom:8px;border-top:1px solid #1e3a2a;padding-top:12px">
  <div style="font-weight:700;color:#e2e8f0;font-size:13px;margin-bottom:6px">${t("Troubleshooting")}</div>
  <div style="margin-bottom:8px">
    <div style="font-weight:600;color:#f87171;font-size:12px">${t("\"IRK added but device not showing up\"")}</div>
    <ul style="margin:4px 0 0;padding-left:20px;font-size:11px">
      <li>${md(t("Make sure the device is **within BLE range** of at least one ESPHome proxy / HA Bluetooth adapter."))}</li>
      <li>${md(t("The device must be **actively advertising** BLE — phones in airplane mode or with Bluetooth off won't appear."))}</li>
      <li>${t("Wait 1-2 minutes after adding the IRK. The Private BLE Device integration needs time to match rotating addresses.")}</li>
      <li>${md(t("On Android, ensure **BLE Transmitter is enabled** in the HA Companion App."))}</li>
      <li>${md(t("Check **Developer Tools → States** in HA — search for {c1} entities.", { c1: "<code style=\"background:#1a2a1a;padding:1px 4px;border-radius:3px\">device_tracker.private_ble_</code>" }))}</li>
    </ul>
  </div>
  <div style="margin-bottom:8px">
    <div style="font-weight:600;color:#f87171;font-size:12px">${t("\"IRK invalid\" error")}</div>
    <ul style="margin:4px 0 0;padding-left:20px;font-size:11px">
      <li>${md(t("Ensure the IRK is exactly **32 hex characters** or a valid **base64 string** (24 chars with padding)."))}</li>
      <li>${t("Remove any surrounding quotes, brackets, or whitespace.")}</li>
      <li>${t("If you copied from macOS plist data inside angle brackets like {c1}, remove the angle brackets.", { c1: "<code style=\"background:#1a2a1a;padding:1px 4px;border-radius:3px\">&lt;a1b2c3d4\u2026&gt;</code>" })}</li>
    </ul>
  </div>
  <div style="margin-bottom:8px">
    <div style="font-weight:600;color:#f87171;font-size:12px">${t("\"Device shows in wrong room / jumps between rooms\"")}</div>
    <ul style="margin:4px 0 0;padding-left:20px;font-size:11px">
      <li>${md(t("This is a **signal strength issue**, not an IRK issue. The IRK only resolves identity — room assignment uses RSSI from your scanners."))}</li>
      <li>${md(t("Add more **ESPHome BLE proxies** to improve coverage. Ideally one per room you want to track."))}</li>
      <li>${md(t("Use the **Calibration** tab to create reference points — this dramatically improves room accuracy."))}</li>
      <li>${md(t("Adjust **Distance Calibration** settings (below) if distance estimates are way off."))}</li>
    </ul>
  </div>
  <div>
    <div style="font-weight:600;color:#f87171;font-size:12px">${t("\"Multiple entries for the same phone\"")}</div>
    <ul style="margin:4px 0 0;padding-left:20px;font-size:11px">
      <li>${t("If you see both a Private BLE entry AND regular BLE entries for the same phone, PadSpan's dedup engine should merge them automatically.")}</li>
      <li>${md(t("Check the **Devices** screen — look for objects with a \"N MACs merged\" badge."))}</li>
      <li>${md(t("If duplicates persist, the phone may be advertising on **multiple protocols simultaneously** (e.g., iBeacon + regular BLE). PadSpan handles this."))}</li>
    </ul>
  </div>
</div>
`;

    irkCard.appendChild(guidePanel);

    put("phones", irkCard);
  }

  // ── Distance Calibration ───────────────────────────────────────────────────
  const currentRefPower   = (settings.ref_power    != null ? Number(settings.ref_power)    : -59);
  const currentPathLoss   = (settings.path_loss_exp != null ? Number(settings.path_loss_exp) : 2.5);
  const refInp = el("input", {
    type: "number", min: "-100", max: "0", step: "1", value: String(currentRefPower), style: inpStyle,
  });
  const plInp = el("input", {
    type: "number", min: "1", max: "4", step: "0.1", value: String(currentPathLoss), style: inpStyle,
  });
  const distSaveBtn = el("button", { class: "btn" }, t("Save"));
  distSaveBtn.addEventListener("click", async () => {
    const ref = Math.max(-100, Math.min(0, parseFloat(refInp.value) || -59));
    const pl  = Math.max(1.0,  Math.min(4.0,  parseFloat(plInp.value)  || 2.5));
    try {
      await ctx.actions.settingsSet({ ref_power: ref, path_loss_exp: pl });
      ctx.toast(t("Distance params saved: ref={ref} dBm, n={exp}", { ref, exp: pl }));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("positioning", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Distance Calibration")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("Parameters for the log-distance path-loss formula used by the sensor.{device}_distance HA entity. Distance (m) = 10 ^ ((ref_power − RSSI) / (10 × n)). Measure ref_power by holding a phone 1 m from a scanner and reading its RSSI. Increase n for cluttered environments (walls, furniture); lower it for open spaces.")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Reference power")),
      refInp,
      el("div", { class: "muted", style: "font-size:12px" }, t("dBm at 1 m (default −59)")),
    ]),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Path-loss exponent")),
      plInp,
      el("div", { class: "muted", style: "font-size:12px" }, t("n  (default 2.5, range 1–4)")),
    ]),
    el("div", { style: "margin-top:8px" }, distSaveBtn),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      t("Current: ref={ref} dBm, n={exp}. Free-space ≈ n=2.0. Typical indoor ≈ n=2.5–3.5.", { ref: currentRefPower, exp: currentPathLoss })
    ),
  ]));

  // ── Signal Filter (Kalman) ────────────────────────────────────────────────
  const currentKalmanQ = (settings.kalman_q != null ? Number(settings.kalman_q) : 3.0);
  const currentKalmanR = (settings.kalman_r != null ? Number(settings.kalman_r) : 8.0);
  const kqInp = el("input", {
    type: "number", min: "0.01", max: "10", step: "0.01", value: String(currentKalmanQ), style: inpStyle,
  });
  const krInp = el("input", {
    type: "number", min: "0.5", max: "50", step: "0.5", value: String(currentKalmanR), style: inpStyle,
  });
  const kalmanSaveBtn = el("button", { class: "btn inline" }, t("Save"));
  kalmanSaveBtn.addEventListener("click", async () => {
    const q = Math.max(0.01, Math.min(10.0, parseFloat(kqInp.value) || 3.0));
    const r = Math.max(0.5, Math.min(50.0, parseFloat(krInp.value) || 8.0));
    try {
      await ctx.actions.settingsSet({ kalman_q: q, kalman_r: r });
      ctx.toast(t("Signal smoothing saved: Q={q}, R={r}", { q, r }));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("positioning", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("Signal smoothing")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("Kalman filter parameters for per-scanner RSSI smoothing. Q (process noise) controls how quickly the filter responds to real movement — lower = more smoothing, slower response. R (measurement noise) controls how much individual RSSI readings are trusted — higher = more smoothing. Defaults: Q=3, R=8 (Q is per update, every 5 s; ESPresense's 0.125 is per advert, many a second).")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Process noise Q")),
      kqInp,
      el("div", { class: "muted", style: "font-size:12px" }, "0.01–10 (default 3)"),
    ]),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Measurement noise R")),
      krInp,
      el("div", { class: "muted", style: "font-size:12px" }, "0.5–50 (default 8.0)"),
    ]),
    el("div", { style: "margin-top:8px" }, kalmanSaveBtn),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      t("Current: Q={q}, R={r}. Increase R to suppress noise at the cost of slower room detection. Increase Q for faster response to movement.", { q: currentKalmanQ, r: currentKalmanR })
    ),
  ]));

  // ── 3D Positioning: assumed device height ─────────────────────────────────
  const currentDevH = (settings.assumed_device_height_m != null
    ? Number(settings.assumed_device_height_m) : 1.0);
  const devHInp = el("input", {
    type: "number", min: "0", max: "3", step: "0.1", value: String(currentDevH), style: inpStyle,
  });
  const devHSaveBtn = el("button", { class: "btn inline" }, t("Save"));
  devHSaveBtn.addEventListener("click", async () => {
    const v = Math.max(0.0, Math.min(3.0, parseFloat(devHInp.value)));
    if (!isFinite(v)) { ctx.toast(t("Enter a height in metres"), true); return; }
    try {
      await ctx.actions.settingsSet({ assumed_device_height_m: v });
      ctx.toast(t("Device height set to {m} m", { m: v }));
    } catch(e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("positioning", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("3D Positioning — Device Height")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("RSSI measures the straight-line (slant) distance to a scanner, but positioning solves on the floor plane. PadSpan deducts the vertical offset between each scanner's mounted height and the device's assumed carry height above the floor. 1.0 m suits a pocketed phone or a wrist; lower it for floor-level tags (robot vacuum, pet collar). Scanner heights come from the saved layout (default: the map's ceiling height); floor stacking from the per-floor heights.")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Device height (m)")),
      devHInp,
      el("div", { class: "muted", style: "font-size:12px" }, "0–3 m (default 1.0)"),
    ]),
    el("div", { style: "margin-top:8px" }, devHSaveBtn),
  ]));

  // ── GPS Bridge (gap #5, best-in-class roadmap) ────────────────────────────
  // The fabric's metre plane has no inherent relationship to a real-world
  // location — these three anchor it, so a tracked object's device_tracker
  // can report a real latitude/longitude and plot on HA's built-in map.
  const gpsLatInp = el("input", {
    type: "number", step: "0.000001", min: "-90", max: "90",
    value: settings.fabric_origin_lat != null ? String(settings.fabric_origin_lat) : "",
    placeholder: "e.g. 49.283", style: inpStyle,
  });
  const gpsLonInp = el("input", {
    type: "number", step: "0.000001", min: "-180", max: "180",
    value: settings.fabric_origin_lon != null ? String(settings.fabric_origin_lon) : "",
    placeholder: "e.g. -123.121", style: inpStyle,
  });
  const gpsBearingInp = el("input", {
    type: "number", step: "1", min: "0", max: "359",
    value: String(settings.fabric_bearing_deg ?? 0),
    style: inpStyle,
  });
  const gpsSaveBtn = el("button", { class: "btn inline" }, t("Save"));
  gpsSaveBtn.addEventListener("click", async () => {
    const latStr = gpsLatInp.value.trim(), lonStr = gpsLonInp.value.trim();
    const lat = latStr === "" ? null : parseFloat(latStr);
    const lon = lonStr === "" ? null : parseFloat(lonStr);
    if ((lat != null && !isFinite(lat)) || (lon != null && !isFinite(lon))) {
      ctx.toast(t("Enter valid coordinates, or leave both blank to disable"), true); return;
    }
    if ((lat == null) !== (lon == null)) {
      ctx.toast(t("Set both latitude and longitude, or clear both"), true); return;
    }
    const rawBearing = ((parseFloat(gpsBearingInp.value) % 360) + 360) % 360;
    const safeBearing = isFinite(rawBearing) ? rawBearing : 0;
    try {
      await ctx.actions.settingsSet({
        fabric_origin_lat: lat, fabric_origin_lon: lon,
        fabric_bearing_deg: safeBearing,
      });
      ctx.toast(lat == null ? t("GPS bridge disabled") : t("GPS origin saved"));
    } catch (e) { ctx.toast(t("Failed to save setting"), true); }
  });
  put("integrations", el("div", { class: "card" }, [
    el("div", { class: "h2" }, t("GPS Bridge")),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      t("Anchor the saved layout to a real-world location so tracked objects' device_tracker entities report a real latitude/longitude and plot on Home Assistant's built-in map — in addition to, not instead of, their room-name state. Leave latitude/longitude blank to disable (no GPS is reported, never a guess at (0, 0)). Bearing is the compass direction, clockwise from true north, that the layout's own +Y axis points toward. +Y runs down your floorplan as it is drawn, so a plan drawn north-up is 180.")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Origin latitude")),
      gpsLatInp,
    ]),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Origin longitude")),
      gpsLonInp,
    ]),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, t("Bearing (°)")),
      gpsBearingInp,
      el("div", { class: "muted", style: "font-size:12px" }, "0–359, clockwise from true north"),
    ]),
    el("div", { style: "margin-top:8px" }, gpsSaveBtn),
  ]));

  // ── Scanner RSSI Offsets ───────────────────────────────────────────────────
  const savedOffsets = settings.scanner_offsets || {};
  const radios = (ctx.state.live?.snapshot?.ble?.radios) || [];
  if(radios.length){
    // (An Auto-Offset Off/Partial/Full selector stood here. Nothing in the
    // backend ever read auto_offset_mode: positioning applies only the manual
    // scanner_offsets. The card said auto and manual "stack" and to set manual
    // to 0 "to use auto only" — which left those scanners uncorrected. The
    // figure below is now shown for what it is: a suggestion to type in.)
    // ── Compute auto-offsets from live advertisement data ──
    // Uses MEDIAN RSSI per scanner (robust to outliers from distant devices).
    // Remote scanners naturally see weaker signals — that's geography, not hardware.
    // To avoid penalizing remote scanners, we only compare each scanner's median
    // to the DEVICE-LEVEL mean: for each device, average across its reporting
    // scanners, then compare each scanner's reading to that average.
    const ads = (ctx.state.live?.snapshot?.ble?.advertisements) || [];
    const scannerMedians = {};
    const scannerRssis = {};
    for (const ad of ads) {
      if (!ad.source || ad.rssi == null || (ad.age_s || 0) > 30) continue;
      if (!scannerRssis[ad.source]) scannerRssis[ad.source] = [];
      scannerRssis[ad.source].push(ad.rssi);
    }
    // Median per scanner
    for (const [src, vals] of Object.entries(scannerRssis)) {
      vals.sort((a, b) => a - b);
      scannerMedians[src] = vals[Math.floor(vals.length / 2)];
    }
    // Fleet median (median of medians)
    const medVals = Object.values(scannerMedians);
    medVals.sort((a, b) => a - b);
    const fleetMedian = medVals.length ? medVals[Math.floor(medVals.length / 2)] : -70;

    // Suggested offset = 50% of (fleet_median - scanner_median), the former
    // "Partial" default (positive = scanner reads weaker, boost it). Shown only.
    const autoScale = 0.5;

    const offsetRows = el("div",{style:"display:flex;flex-direction:column;gap:8px;margin-top:8px"});
    for(const radio of radios){
      const src = radio.source || radio.name || "";
      if(!src) continue;
      const manualOffset = savedOffsets[src] != null ? Number(savedOffsets[src]) : 0;
      const scanMed = scannerMedians[src];
      const autoOff = (scanMed != null && autoScale > 0) ? Math.round((fleetMedian - scanMed) * autoScale * 10) / 10 : 0;
      const effectiveOff = manualOffset + autoOff;
      const friendlyName = radio.name && radio.name !== src ? radio.name : "";

      const offInp = el("input",{type:"number",min:"-20",max:"20",step:"0.5",value:String(manualOffset),style:inpStyle});
      const offSaveBtn = el("button",{class:"btn inline"},t("Save"));
      offSaveBtn.addEventListener("click", async()=>{
        // Only a newly typed value is held to ±20. A stored offset outside it
        // (1 m Reference Calibration saves what it measures; the server takes
        // ±50) is shown as it is and saved unchanged when Save is pressed on
        // it: clamping it here cut it to ±20 without a word.
        const typed = parseFloat(offInp.value)||0;
        const v = typed === manualOffset ? typed : Math.max(-20, Math.min(20, typed));
        try {
          await ctx.actions.scannerOffsetSet(src, v);
          ctx.toast(t("{name}: manual offset set to {db} dB", { name: friendlyName || src, db: `${v>0?"+":""}${v}` }));
        } catch(e){ ctx.toast(t("Failed to save offset"), true); }
      });

      const autoLabel = autoOff !== 0
        ? el("span",{style:`font-size:10px;color:${autoOff > 0 ? "#52b788" : "#f59e0b"}`, title:t("Not applied. Type it into the box and Save to use it.")}, t("suggested: {db}", { db: `${autoOff > 0?"+":""}${autoOff.toFixed(1)}` }))
        : el("span",{style:"font-size:10px;color:#64748b"}, t("suggested: {db}", { db: 0 }));
      const medLabel = scanMed != null
        ? el("span",{style:"font-size:10px;color:#64748b"}, t("med: {dbm}dBm", { dbm: scanMed }))
        : null;

      offsetRows.appendChild(el("div",{style:rowStyle},[
        el("div",{style:"min-width:160px;overflow:hidden;text-overflow:ellipsis"},[
          friendlyName ? el("div",{style:"font-size:12px;color:#a7f3d0;font-weight:600"},friendlyName) : null,
          el("div",{style:"font-size:10px;color:#94a3b8;font-family:monospace"},src.substring(0,30)),
        ].filter(Boolean)),
        offInp,
        el("div",{class:"muted",style:"font-size:11px"},"dB"),
        offSaveBtn,
        autoLabel,
        medLabel,
      ].filter(Boolean)));
    }
    put("receivers", el("div",{class:"card"},[
      el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap"},[
        el("div",{class:"h2",style:"margin:0"},t("Receiver signal adjustments")),
        ctx.actions.openReceivers && (!ctx.actions.canOpen || ctx.actions.canOpen("receivers")) ? el("button",{class:"btn inline","data-all-receivers":"settings",style:"font-size:11px;padding:2px 10px;margin:0",onclick:()=>ctx.actions.openReceivers()},t("All receivers")) : null,
      ].filter(Boolean)),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        t("Only the manual offset you save is applied. The suggestion beside it is half the gap between this scanner's median signal and the fleet median, from live data — a starting point for hardware differences; type it in and Save to use it. A remote scanner reads weaker because of distance, not hardware, so don't copy its suggestion blindly.")
      ),
      offsetRows,
      el("div",{class:"muted",style:"font-size:11px;margin-top:8px"},
        t("Fleet median: {dbm} dBm • Manual range: −20 to +20 dB • Only the manual offset is applied.", { dbm: fleetMedian })
      ),
    ]));
  }

  // ── Calibration Accuracy Reminder ─────────────────────────────────────────
  const reminderEnabled = settings.health_reminder_enabled === true;
  const reminderLastTs  = settings.health_reminder_last_ts || null;

  const reminderToggle = el("input",{type:"checkbox",id:"healthReminderToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
  reminderToggle.checked = reminderEnabled;

  const reminderResultDiv = el("div",{style:"margin-top:10px"});

  const _sid = ctx.helpers.radioShortId || (()=>"");
  const _renderHealthResults = (r)=>{
    while(reminderResultDiv.firstChild) reminderResultDiv.removeChild(reminderResultDiv.firstChild);
    if(!r){ return; }
    const rows = [];
    if(r.point_count === 0){
      rows.push(el("div",{class:"muted",style:"font-size:12px"},
        t("No calibration data collected yet. Use Calibration → Pin & Listen to get started.")));
    } else {
      const ptsLine = r.stale_days != null
        ? tn(r.point_count, "{n} calibration point · newest is {age} old", "{n} calibration points · newest is {age} old",
          { age: tn(r.stale_days, "{n} day", "{n} days") })
        : tn(r.point_count, "{n} calibration point · newest is unknown age old", "{n} calibration points · newest is unknown age old");
      const ageColor = (r.stale_days||0) > 60 ? "#fbbf24" : "#52b788";
      rows.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:`color:${ageColor};font-weight:600`}, (r.stale_days||0)>60?"⚠ ":"✓ "),
        el("span",{class:"muted"},ptsLine),
      ]));
    }

    // Scanner summary table — name, short ID, points, mean RSSI
    const scanners = r.scanner_summary || [];
    if(scanners.length){
      rows.push(el("div",{style:"font-size:11px;font-weight:600;color:#e2e8f0;margin:8px 0 4px"},
        t("Scanners in calibration data ({count}):", { count: scanners.length })));
      const tbl = el("div",{style:"display:flex;flex-direction:column;gap:2px;margin-bottom:8px"});
      for(const sc of scanners){
        const sid = _sid(sc.source);
        const name = sc.name || sc.source.slice(-12);
        const rssiColor = sc.mean_rssi > -65 ? "#52b788" : sc.mean_rssi > -78 ? "#fbbf24" : "#f87171";
        // Check if this scanner has an anomaly
        const anomaly = (r.scanner_anomalies||[]).find(a => a.scanner === sc.source);
        const rowBorder = anomaly ? "border-left:2px solid #fbbf24;" : "border-left:2px solid #1e3a2a;";
        const row = el("div",{style:`display:grid;grid-template-columns:28px 1fr auto auto;gap:6px;align-items:center;padding:3px 6px;background:#0a150e;border-radius:4px;${rowBorder}`},[
          el("span",{style:"font-family:monospace;font-size:10px;font-weight:700;color:#52b788;letter-spacing:.04em"}, sid),
          el("span",{style:"font-size:11px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, name),
          el("span",{style:"font-size:10px;color:#94a3b8;white-space:nowrap"}, `${sc.point_count} pt`),
          el("span",{style:`font-size:10px;color:${rssiColor};font-family:monospace;white-space:nowrap`}, `${sc.mean_rssi} dBm`),
        ]);
        if(anomaly){
          const tipDiv = el("div",{style:"grid-column:1/-1;font-size:10px;color:#fbbf24;padding:2px 0 0 34px"},
            anomaly.deviation_db > 0
              ? t("⚠ {db} dBm above fleet avg — consider RSSI offset or re-calibration", { db: Math.abs(anomaly.deviation_db) })
              : t("⚠ {db} dBm below fleet avg — consider RSSI offset or re-calibration", { db: Math.abs(anomaly.deviation_db) }));
          row.appendChild(tipDiv);
        }
        tbl.appendChild(row);
      }
      rows.push(tbl);
    }

    if((r.recommended_spots||[]).length){
      // Group spots by map for cleaner display
      const spotsByMap = new Map();
      for(const spot of (r.recommended_spots||[])){
        const key = spot.map_id;
        if(!spotsByMap.has(key)) spotsByMap.set(key, { name: spot.map_name || spot.map_id.slice(0,8), spots: [] });
        spotsByMap.get(key).spots.push(spot);
      }
      rows.push(el("div",{style:"font-size:11px;font-weight:600;color:#e2e8f0;margin:8px 0 4px"},
        tn(spotsByMap.size, "Coverage gaps ({n} map)", "Coverage gaps ({n} maps)")));
      const spotsWrap = el("div",{style:"display:flex;flex-direction:column;gap:6px;margin-bottom:6px"});
      for(const [, mapGroup] of spotsByMap){
        const mapDiv = el("div",{style:"background:#0a150e;border-radius:4px;padding:6px 8px;border-left:2px solid #f59e0b"});
        mapDiv.appendChild(el("div",{style:"font-size:11px;font-weight:600;color:#e2e8f0;margin-bottom:3px"}, mapGroup.name));
        for(const spot of mapGroup.spots){
          const pct = x=>Math.round(x*100);
          const scoreLabel = spot.coverage_score<0.2 ? t("uncovered") : spot.coverage_score<0.5 ? t("sparse") : t("partial");
          const scoreColor = spot.coverage_score<0.2 ? "#f87171" : spot.coverage_score<0.5 ? "#fbbf24" : "#94a3b8";
          mapDiv.appendChild(el("div",{style:"font-size:10px;color:#94a3b8;margin-bottom:1px;display:flex;gap:6px"},[
            el("span",{}, `(${pct(spot.x_frac)}%, ${pct(spot.y_frac)}%)`),
            el("span",{style:`color:${scoreColor}`}, scoreLabel),
          ]));
        }
        spotsWrap.appendChild(mapDiv);
      }
      rows.push(spotsWrap);
      rows.push(el("div",{class:"muted",style:"font-size:10px"},
        t("Stand at each position with your beacon for 60 s. Open Calibration → Pin & Listen to collect.")));
    }
    if(!r.has_issues && r.point_count > 0){
      rows.push(el("div",{style:"font-size:12px;color:#52b788"},t("✓ Calibration data looks good — no issues detected.")));
    }
    for(const row of rows) reminderResultDiv.appendChild(row);
  };

  _renderHealthResults(ctx.state._healthCheckResult || null);

  const checkNowBtn = el("button",{class:"btn",style:"margin-top:8px"},t("Check Now"));
  checkNowBtn.addEventListener("click", async()=>{
    checkNowBtn.disabled=true; checkNowBtn.textContent=t("Checking…");
    try {
      const r = await ctx.actions.calibrationHealthCheck();
      ctx.state._healthCheckResult = r;
      _renderHealthResults(r);
      await ctx.actions.settingsSet({ health_reminder_last_ts: Date.now()/1000 });
    } catch(e){ ctx.toast(t("Health check failed: {error}", { error: ctx.helpers.errorText(e) }), true); }
    finally{ checkNowBtn.disabled=false; checkNowBtn.textContent=t("Check Now"); }
  });

  reminderToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ health_reminder_enabled: reminderToggle.checked });
      ctx.toast(reminderToggle.checked ? t("Calibration reminders enabled") : t("Calibration reminders disabled"));
    } catch(e){ ctx.toast(t("Failed to save setting"), true); }
  });

  const lastCheckedTxt = reminderLastTs
    ? t("Last checked: {date}", { date: new Date(reminderLastTs*1000).toLocaleDateString() })
    : t("Never checked");

  put("positioning", el("div",{class:"card"},[
    el("div",{class:"h2"},t("Calibration Accuracy Reminders")),
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      reminderToggle,
      el("label",{for:"healthReminderToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer"},
        t("Remind me to update calibration when needed for accuracy")),
    ]),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      t("Checks whether calibration data has gaps, stale readings, or scanner anomalies. When issues are found, suggests a few specific spots to stand with your beacon for 60 s each. Off by default.")),
    el("div",{style:"display:flex;align-items:center;gap:12px;flex-wrap:wrap"},[
      checkNowBtn,
      el("span",{class:"muted",style:"font-size:12px"}, lastCheckedTxt),
    ]),
    reminderResultDiv,
  ]));

  // ── Adaptive Learning (Experimental) ───────────────────────────────────
  const adaptiveEnabled = settings.adaptive_learning_enabled === true;
  const floorDetEnabled = settings.adaptive_floor_detection === true;

  const adaptiveToggle = el("input",{type:"checkbox",id:"adaptiveLearningToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
  adaptiveToggle.checked = adaptiveEnabled;

  const floorToggle = el("input",{type:"checkbox",id:"adaptiveFloorToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
  floorToggle.checked = floorDetEnabled;

  const adaptiveStatusDiv = el("div",{style:"margin-top:10px"});

  const _renderAdaptiveStatus = (s)=>{
    while(adaptiveStatusDiv.firstChild) adaptiveStatusDiv.removeChild(adaptiveStatusDiv.firstChild);
    if(!s || !s.total_observations){
      adaptiveStatusDiv.appendChild(el("div",{class:"muted",style:"font-size:12px"},
        adaptiveEnabled ? t("Learning... waiting for high-confidence room assignments.") : t("Enable to start learning from device movements.")));
      return;
    }
    const matPct = s.maturity_pct || 0;
    const barColor = matPct < 25 ? "#fbbf24" : matPct < 75 ? "#38bdf8" : "#52b788";
    const rows = [
      el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:"font-weight:600;color:#e2e8f0"},t("Maturity:") + " "),
        el("span",{style:`color:${barColor};font-weight:600`}, `${matPct}%`),
        el("span",{class:"muted"}, ` — ${matPct < 25 ? t("collecting baseline") : matPct < 75 ? t("building model") : t("model active")}`),
      ]),
      el("div",{style:"background:#1b3526;border-radius:4px;height:6px;margin-bottom:8px;overflow:hidden"},[
        el("div",{style:`width:${Math.min(100,matPct)}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.3s`}),
      ]),
      el("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px"},[
        el("span",{class:"muted"},t("Observations: {count}", { count: (s.total_observations||0).toLocaleString() })),
        el("span",{class:"muted"},t("Days active: {count}", { count: s.days_active||0 })),
        el("span",{class:"muted"},t("Rooms learned: {count}", { count: s.rooms_learned||0 })),
        el("span",{class:"muted"},t("Scanners: {count}", { count: s.scanners_learned||0 })),
        el("span",{class:"muted"},t("Transitions: {count}", { count: (s.transitions_total||0).toLocaleString() })),
        el("span",{class:"muted"},t("Floor pairs: {count}", { count: s.floor_pairs_learned||0 })),
      ]),
    ];
    for(const r of rows) adaptiveStatusDiv.appendChild(r);
  };

  // Load adaptive status on render
  if(adaptiveEnabled){
    (async()=>{
      try {
        const r = await ctx.actions.wsCall("padspan_ha/adaptive_status_get");
        _renderAdaptiveStatus(r?.adaptive || null);
      } catch(e){ /* best-effort */ }
    })();
  }
  _renderAdaptiveStatus(null);

  adaptiveToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ adaptive_learning_enabled: adaptiveToggle.checked });
      ctx.toast(adaptiveToggle.checked ? t("Adaptive learning enabled") : t("Adaptive learning disabled"));
      if(!adaptiveToggle.checked){
        floorToggle.checked = false;
        floorToggle.disabled = true;
      } else {
        floorToggle.disabled = false;
      }
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast(t("Failed to save setting"), true); }
  });

  floorToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ adaptive_floor_detection: floorToggle.checked });
      ctx.toast(floorToggle.checked ? t("Floor detection enhancement enabled") : t("Floor detection enhancement disabled"));
    } catch(e){ ctx.toast(t("Failed to save setting"), true); }
  });

  if(!adaptiveEnabled) floorToggle.disabled = true;

  const resetAdaptiveBtn = el("button",{class:"btn",style:"margin-top:8px;background:#991b1b;border-color:#991b1b"},t("Reset Learned Data"));
  resetAdaptiveBtn.addEventListener("click", async()=>{
    if(!confirm(t("Clear all adaptive learning data? This cannot be undone."))) return;
    resetAdaptiveBtn.disabled=true; resetAdaptiveBtn.textContent=t("Resetting…");
    try {
      await ctx.actions.wsCall("padspan_ha/adaptive_reset");
      ctx.toast(t("Adaptive learning data cleared"));
      _renderAdaptiveStatus(null);
    } catch(e){ ctx.toast(t("Reset failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
    finally{ resetAdaptiveBtn.disabled=false; resetAdaptiveBtn.textContent=t("Reset Learned Data"); }
  });

  put("positioning", el("div",{class:"card","data-focus-part":"adaptive_learning"},[
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
      el("div",{class:"h2",style:"margin:0"},t("Adaptive Learning")),
      el("span",{style:"font-size:10px;font-weight:600;color:#fbbf24;background:#422006;padding:2px 6px;border-radius:4px"},t("EXPERIMENTAL")),
    ]),
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      adaptiveToggle,
      el("label",{for:"adaptiveLearningToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer"},
        t("Enable adaptive learning")),
    ]),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      t("When enabled, PadSpan passively learns room RSSI fingerprints from high-confidence room assignments. Over days, this tightens radio propagation models for more accurate room detection without manual calibration walks. The system also learns room transition patterns to reduce false room changes.")),
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      floorToggle,
      el("label",{for:"adaptiveFloorToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer"},
        t("Enhance floor-to-floor detection")),
    ]),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      t("Learns cross-floor signal attenuation patterns to better distinguish between rooms on different floors. Requires scanners assigned to rooms on multiple floors in Home Assistant.")),
    adaptiveStatusDiv,
    resetAdaptiveBtn,
  ]));

  // ── PadSpan Automations ───────────────────────────────────────────────
  {
    const rules = settings.padspan_automations || [];
    const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
    const objList = snap?.objects?.list || [];

    // Build device options from labelled objects
    const deviceOpts = [];
    const _seen = new Set();
    for (const o of objList) {
      const lbl = o.user_label || "";
      const key = o.key || "";
      if (lbl && !_seen.has(lbl.toUpperCase())) {
        _seen.add(lbl.toUpperCase());
        deviceOpts.push({ label: lbl, key });
      }
    }
    deviceOpts.sort((a, b) => a.label.localeCompare(b.label));

    // Build entity options (lights, switches, scenes)
    const _entities = Object.keys(ctx.hass?.states || {}).filter(e =>
      e.startsWith("light.") || e.startsWith("switch.") || e.startsWith("scene.") || e.startsWith("script.")
    ).filter(e => !(TW && TW.duplicateOf(e, ctx.state.settings))).sort();   // a Zigbee device's duplicate copy left out (views/zigbee_twins.js)

    const _saveRules = async (newRules) => {
      try {
        await ctx.actions.settingsSet({ padspan_automations: newRules });
        ctx.state.settings = { ...ctx.state.settings, padspan_automations: newRules };
        ctx.toast(t("Automation saved"));
      } catch(e) { ctx.toast(t("Save failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
    };

    const _deleteRule = (idx) => {
      const updated = [...rules];
      updated.splice(idx, 1);
      _saveRules(updated);
    };

    const _toggleRule = (idx) => {
      const updated = rules.map((r, i) => i === idx ? { ...r, enabled: !r.enabled } : r);
      _saveRules(updated);
    };

    // Existing rules list
    const ruleEls = rules.map((r, idx) => {
      const lbl = r.device_label || r.device_key || "?";
      const arrow = r.trigger === "arrive" ? "\u2192" : "\u2190";
      const actionLbl = r.action === "turn_on" ? t("ON") : r.action === "turn_off" ? t("OFF") : r.action;
      const entShort = (r.entity_id || "").split(".").pop() || "?";
      const opacity = r.enabled ? "1" : "0.4";
      const row = el("div",{style:`display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #1b3526;opacity:${opacity}`},[
        el("span",{style:"font-size:11px;min-width:50px;color:#94a3b8"}, r.trigger === "arrive" ? t("ARRIVE") : t("DEPART")),
        el("span",{style:"font-size:12px;color:#e2e8f0;flex:1"}, `${lbl} ${arrow} ${actionLbl} ${entShort}`),
        el("button",{style:"background:none;border:none;color:#60a5fa;cursor:pointer;font-size:11px",title:t("Toggle")}, r.enabled ? t("ON") : t("OFF")),
        el("button",{style:"background:none;border:none;color:#f87171;cursor:pointer;font-size:11px",title:t("Delete")}, "\u2715"),
      ]);
      row.children[2].addEventListener("click", () => _toggleRule(idx));
      row.children[3].addEventListener("click", () => { if(confirm(t("Delete this automation?"))) _deleteRule(idx); });
      return row;
    });

    // Add new rule form
    const triggerSel = el("select",{style:"font-size:12px;background:#071008;color:#e2e8f0;border:1px solid #2d4a38;border-radius:4px;padding:4px"},[
      el("option",{value:"depart"},t("When device DEPARTS")),
      el("option",{value:"arrive"},t("When device ARRIVES")),
    ]);
    const deviceSel = el("select",{style:"font-size:12px;background:#071008;color:#e2e8f0;border:1px solid #2d4a38;border-radius:4px;padding:4px"},[
      el("option",{value:""},t("— Select device —")),
      ...deviceOpts.map(d => el("option",{value:d.label}, d.label)),
    ]);
    const actionSel = el("select",{style:"font-size:12px;background:#071008;color:#e2e8f0;border:1px solid #2d4a38;border-radius:4px;padding:4px"},[
      el("option",{value:"turn_off"},t("Turn OFF")),
      el("option",{value:"turn_on"},t("Turn ON")),
    ]);
    const entitySel = el("select",{style:"font-size:12px;background:#071008;color:#e2e8f0;border:1px solid #2d4a38;border-radius:4px;padding:4px;max-width:200px"},[
      el("option",{value:""},t("— Select entity —")),
      ..._entities.map(e => el("option",{value:e}, e.split(".").pop())),
    ]);

    const addBtn = el("button",{class:"btn",style:"background:#065f46;border-color:#065f46;font-size:12px;padding:4px 12px"},t("Add Rule"));
    addBtn.addEventListener("click", () => {
      const dev = deviceSel.value;
      const ent = entitySel.value;
      if (!dev || !ent) { ctx.toast(t("Select a device and entity"), true); return; }
      if (ent.startsWith("scene.") && actionSel.value === "turn_off") {
        ctx.toast(t("A scene can only be turned on - Home Assistant has no way to turn one off"), true); return;
      }
      const devOpt = deviceOpts.find(d => d.label === dev);
      const newRule = {
        id: "auto_" + Date.now().toString(36),
        trigger: triggerSel.value,
        device_key: devOpt ? devOpt.key : "",
        device_label: dev,
        action: actionSel.value,
        entity_id: ent,
        enabled: true,
      };
      _saveRules([...rules, newRule]);
    });

    const cardChildren = [
      el("div",{class:"h2",style:"margin-bottom:4px"},t("Automations")),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        t("Simple arrive/depart rules. PadSpan also fires HA events (padspan_device_arrived, padspan_device_departed) for labelled devices, so you can build complex automations in HA. Unlabelled devices don't fire events — every rotating-MAC rotation would register as a new arrival and flood the event bus — but the rules above still match them.")),
    ];
    if (ruleEls.length) {
      cardChildren.push(el("div",{style:"margin-bottom:10px"}, ruleEls));
    } else {
      cardChildren.push(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px;font-style:italic"}, t("No rules yet")));
    }
    cardChildren.push(el("div",{style:"display:flex;flex-wrap:wrap;align-items:center;gap:6px"},[
      triggerSel, deviceSel, actionSel, entitySel, addBtn,
    ]));
    put("integrations", el("div",{class:"card"}, cardChildren));
  }

  // ── Lights follow people (lights_follow.py): off until turned on here ──
  if (LIGHTS_FOLLOW) put("integrations", LIGHTS_FOLLOW.lightsFollowSection(ctx, el));

  // ── Suspend Databases (raw radio test) ─────────────────────────────────
  {
    const _snap = ctx.state.live?.snapshot;
    const _isActive = _snap?.suspended === true;
    const _remS = _snap?.suspend_remaining_s ?? 0;
    const _mm = Math.floor(_remS / 60);
    const _ss = _remS % 60;
    const _countdownStr = _remS > 0 ? t("{time} remaining", { time: `${_mm}:${String(_ss).padStart(2,"0")}` }) : "";

    const cardChildren = [
      el("div",{class:"h2",style:"margin-bottom:4px"},t("Positioning Test Mode")),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        t("Temporarily suspend all learned databases (Kalman state, vote windows, scanner reliability, k-NN cache, adaptive learning) and use only raw radio RSSI with spatial weighted-centroid positioning. Useful for diagnosing whether accumulated state is causing incorrect room assignments. Calibration data and settings are preserved — only in-memory smoothing state is cleared.")),
    ];

    if (_isActive) {
      // ── Active: show status, countdown, cancel ──
      const statusRow = el("div",{style:
        "display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:6px;" +
        "background:linear-gradient(135deg,#78350f,#92400e);border:1px solid #b45309;margin-bottom:8px"
      },[
        el("span",{style:"font-size:18px"}, "\u26a0\ufe0f"),
        el("div",{style:"flex:1"},[
          el("div",{style:"color:#fbbf24;font-weight:700;font-size:13px"}, t("SUSPENDED — Raw Radio Mode Active")),
          el("div",{style:"color:#fde68a;font-size:12px;margin-top:2px"},
            _countdownStr
              ? t("All learned databases bypassed · {left}", { left: _countdownStr })
              : t("All learned databases bypassed \u00b7 ending soon")),
        ]),
      ]);
      cardChildren.push(statusRow);

      const cancelBtn = el("button",{class:"btn",style:"background:#991b1b;border-color:#991b1b"},t("Resume Normal Pipeline"));
      cancelBtn.addEventListener("click", async()=>{
        cancelBtn.disabled=true; cancelBtn.textContent=t("Resuming\u2026");
        try {
          // The handler answers {ok:false} (not an error) when the coordinator
          // isn't ready yet; that read as success.
          const r = await ctx.actions.wsCall("padspan_ha/unsuspend_databases");
          if (r && r.ok === false) { ctx.toast(t("Not resumed: {why}", { why: r.error || t("try again in a moment") }), true); return; }
          ctx.toast(t("Normal pipeline resumed \u2014 smoothing state cleared for fresh start"));
          await ctx.actions.refreshSnapshot();   // refreshLive never existed: the card kept offering the old state
        } catch(e){ ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
        finally{ cancelBtn.disabled=false; cancelBtn.textContent=t("Resume Normal Pipeline"); }
      });
      cardChildren.push(cancelBtn);
    } else {
      // ── Inactive: show activate button ──
      const suspendBtn = el("button",{class:"btn",style:"background:#0369a1;border-color:#0369a1"},t("Suspend All Databases (60 min)"));
      suspendBtn.addEventListener("click", async()=>{
        if(!confirm(t("Suspend all learned databases for 60 minutes?\n\nThis clears Kalman filters, vote windows, scanner reliability, and cached positions.\nOnly raw radio RSSI + spatial centroid positioning will be used.\n\nCalibration data and settings are NOT deleted."))) return;
        suspendBtn.disabled=true; suspendBtn.textContent=t("Suspending\u2026");
        try {
          const r = await ctx.actions.wsCall("padspan_ha/suspend_databases",{minutes:60});
          if (r && r.ok === false) { ctx.toast(t("Not suspended: {why}", { why: r.error || t("try again in a moment") }), true); return; }
          ctx.toast(t("Databases suspended \u2014 raw radio mode for 60 minutes"));
          await ctx.actions.refreshSnapshot();   // refreshLive never existed: the card kept offering the old state
        } catch(e){ ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
        finally{ suspendBtn.disabled=false; suspendBtn.textContent=t("Suspend All Databases (60 min)"); }
      });
      cardChildren.push(suspendBtn);
    }

    put("positioning", el("div",{class:"card"}, cardChildren));
  }

  // ── HA Tags Integration ─────────────────────────────────────────────────
  {
    const tagsRoomEvt = settings.tags_room_events_enabled === true;
    const tagsNfc = settings.tags_nfc_identify_enabled === true;
    const tagsAutolink = settings.tags_phone_autolink_enabled === true;

    const roomEvtToggle = el("input",{type:"checkbox",id:"tagsRoomEvtToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    roomEvtToggle.checked = tagsRoomEvt;
    roomEvtToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ tags_room_events_enabled: roomEvtToggle.checked });
        ctx.toast(roomEvtToggle.checked ? t("Room-change tag events enabled") : t("Room-change tag events disabled"));
      } catch(e){ ctx.toast(t("Failed to save"), true); }
    });

    const nfcToggle = el("input",{type:"checkbox",id:"tagsNfcToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    nfcToggle.checked = tagsNfc;
    nfcToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ tags_nfc_identify_enabled: nfcToggle.checked });
        ctx.toast(nfcToggle.checked ? t("NFC tap-to-identify enabled") : t("NFC tap-to-identify disabled"));
      } catch(e){ ctx.toast(t("Failed to save"), true); }
    });

    const autolinkToggle = el("input",{type:"checkbox",id:"tagsAutolinkToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    autolinkToggle.checked = tagsAutolink;
    autolinkToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ tags_phone_autolink_enabled: autolinkToggle.checked });
        ctx.toast(autolinkToggle.checked ? t("Phone auto-link enabled") : t("Phone auto-link disabled"));
      } catch(e){ ctx.toast(t("Failed to save"), true); }
    });

    // Tag mappings info (async load)
    const mappingsDiv = el("div",{style:"margin-top:10px;display:none"});
    (async () => {
      try {
        const res = await ctx.actions.wsCall("padspan_ha/tags_status", {});
        if (!res.tag_available) {
          mappingsDiv.style.display = "";
          mappingsDiv.appendChild(el("div",{style:"font-size:12px;color:#fbbf24;padding:6px 10px;background:#422006;border-radius:4px"},
            t("HA Tags component not loaded. Add a Tag in HA Settings \u2192 Tags to enable it.")));
          return;
        }
        const maps = res.followed_tag_mappings || [];
        if (maps.length && tagsRoomEvt) {
          mappingsDiv.style.display = "";
          mappingsDiv.appendChild(el("div",{style:"font-size:12px;font-weight:600;color:#94a3b8;margin-bottom:4px"},
            tn(maps.length, "Tag ID for {n} followed object:", "Tag IDs for {n} followed objects:")));
          for (const m of maps.slice(0, 10)) {
            mappingsDiv.appendChild(el("div",{style:"font-size:11px;color:#64748b;padding:2px 0"},
              `${m.label} \u2192 tag_id: "${m.tag_id}"`));
          }
          mappingsDiv.appendChild(el("div",{style:"font-size:11px;color:#64748b;margin-top:4px"},
            t("Use these tag_ids in HA Automations to trigger actions on room changes.")));
        }
      } catch(e) {}
    })();

    put("integrations", el("div",{class:"card"},[
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px"},[
        el("div",{class:"h2",style:"margin:0;color:#60a5fa"}, t("HA Tags Integration")),
      ]),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:12px"},
        t("Connect PadSpan to Home Assistant's Tags system for automations and easy object setup.")),
      el("div",{style:"display:flex;flex-direction:column;gap:10px"},[
        el("div",{style:"padding:10px;background:#071008;border-radius:6px"},[
          el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
            roomEvtToggle,
            el("label",{for:"tagsRoomEvtToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
              t("Room-change tag events")),
          ]),
          el("div",{style:"font-size:11px;color:#64748b"},
            t("Fires a tag_scanned event when a followed object changes rooms. Build HA automations that trigger on room transitions (e.g. turn on lights when you enter a room).")),
        ]),
        el("div",{style:"padding:10px;background:#071008;border-radius:6px"},[
          el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
            nfcToggle,
            el("label",{for:"tagsNfcToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
              t("NFC tap-to-identify")),
          ]),
          el("div",{style:"font-size:11px;color:#64748b"},
            t("Scan an NFC tag near an unidentified BLE object to auto-label and follow it. PadSpan matches the scanning phone's room to the nearest unidentified BLE signal.")),
        ]),
        el("div",{style:"padding:10px;background:#071008;border-radius:6px"},[
          el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
            autolinkToggle,
            el("label",{for:"tagsAutolinkToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
              t("Phone auto-link on NFC scan")),
          ]),
          el("div",{style:"font-size:11px;color:#64748b"},
            t("When a phone scans any NFC tag, PadSpan auto-discovers and follows that phone's BLE Transmitter. A quick way to onboard new phones without visiting the Overview page.")),
        ]),
      ]),
      mappingsDiv,
    ]));
  }

  // ── Ignore Bermuda Data (Experimental) ──────────────────────────────────
  const bermudaIgnore = settings.bermuda_ignore === true;

  const bermudaToggle = el("input",{type:"checkbox",id:"bermudaIgnoreToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
  bermudaToggle.checked = bermudaIgnore;

  const bermudaStatusEl = el("span",{style:"font-size:11px;color:#94a3b8"});
  bermudaToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ bermuda_ignore: bermudaToggle.checked });
      ctx.toast(bermudaToggle.checked ? t("Bermuda data will be ignored") : t("Bermuda data re-enabled"));
      bermudaStatusEl.textContent = t("Saved — refresh snapshot to apply");
      bermudaStatusEl.style.color = "#fbbf24";
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast(t("Failed to save setting"), true); }
  });

  const refreshBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:3px 10px"}, t("Refresh Snapshot"));
  refreshBtn.addEventListener("click", async()=>{
    refreshBtn.disabled = true; refreshBtn.textContent = t("Refreshing…");
    try {
      await ctx.actions.refreshSnapshot();
      bermudaStatusEl.textContent = t("Snapshot refreshed");
      bermudaStatusEl.style.color = "#52b788";
      ctx.toast(t("Snapshot refreshed"));
    } catch(e){ ctx.toast(t("Refresh failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
    finally { refreshBtn.disabled = false; refreshBtn.textContent = t("Refresh Snapshot"); }
  });

  put("integrations", _voiceQuestionsCard(ctx, el));

  put("integrations", el("div",{class:"card"},[
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
      el("div",{class:"h2",style:"margin:0"},t("Ignore Bermuda")),
      el("span",{style:"font-size:10px;font-weight:600;color:#fbbf24;background:#422006;padding:2px 6px;border-radius:4px"},t("EXPERIMENTAL")),
    ]),
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      bermudaToggle,
      el("label",{for:"bermudaIgnoreToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer"},
        t("Ignore all Bermuda integration data")),
    ]),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      t("When enabled, PadSpan completely ignores all data from the Bermuda integration — no Bermuda devices, receivers, or entity candidates will appear in snapshots. Useful for troubleshooting to isolate whether unexpected activity originates from Bermuda.")),
    el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap"},[
      refreshBtn,
      bermudaStatusEl,
    ]),
  ]));

  for (const sec of _presenceSections(ctx, el, bins)) wrap.appendChild(sec);
  return wrap;
}

// ── Voice: "Which room is Alice in?" (2026-11-21) ──────────────────────────
// Assist answers it through PadSpan's PadSpanWhereIs intent (intents.py), but
// only once the sentences are in config/custom_sentences, and they lived only
// in docs/GETTING_STARTED.md. The same sentences here, word for word (held
// equal by tests/test_plain_problems.py), with examples in the name of one of
// this house's own devices, the answers, and a Copy button.
// i18n part: -
export const VOICE_SENTENCES_PATH = "config/custom_sentences/en/padspan.yaml";
export const VOICE_SENTENCES_YAML = [
  'language: "en"',
  "intents:",
  "  PadSpanWhereIs:",
  "    data:",
  "      - sentences:",
  '          - "which room is {padspan_person} in"',
  '          - "what room is {padspan_person} in"',
  '          - "where in the house is {padspan_person}"',
  "lists:",
  "  padspan_person:",
  "    wildcard: true",
].join("\n") + "\n";

function _voiceQuestionsCard(ctx, el) {
  // A name from this house, the way the answer finds it: a device's PadSpan name (its label).
  const objs = (ctx.state.live && ctx.state.live.snapshot && ctx.state.live.snapshot.objects && ctx.state.live.snapshot.objects.list) || [];
  const named = objs.find(o => o && typeof o.user_label === "string" && o.user_label.trim());
  const who = named ? named.user_label.trim() : "Alice";
  const asks = [`Which room is ${who} in?`, `What room is ${who} in?`, `Where in the house is ${who}?`];
  const answers = [`${who} is in the Kitchen.`, `${who} is probably in the Kitchen.`, `${who} is away.`];
  const list = (items) => el("ul", { style: "margin:4px 0 8px 18px;padding:0;font-size:13px;color:#e2e8f0" },
    items.map(x => el("li", {}, x)));
  const yaml = el("pre", { class: "mono", "data-voice-yaml": "", style: "margin:6px 0;padding:8px;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;font-size:11px;white-space:pre;overflow:auto" }, VOICE_SENTENCES_YAML);
  const copy = el("button", { class: "btn inline", "data-voice-copy": "" }, t("Copy the sentences"));
  copy.addEventListener("click", async () => {
    ctx.toast(await copyText(VOICE_SENTENCES_YAML)
      ? t("Copied. Save them as {path}, then restart Home Assistant.", { path: VOICE_SENTENCES_PATH })
      : t("Copy was blocked: select the lines and copy them yourself."), false);
  });
  return el("div", { class: "card", "data-voice-questions": "" }, [
    el("div", { class: "h2", style: "color:#52b788" }, t("Ask Assist which room someone is in")),
    el("div", { class: "muted", style: "font-size:12px" },
      t("Home Assistant's voice assistant, Assist, can tell you which room a person or thing is in. Ask with the name the device has in PadSpan, for example:")),
    list(asks),
    el("div", { class: "muted", style: "font-size:12px" }, t("It answers like this:")),
    list(answers),
    el("div", { class: "muted", style: "font-size:12px" },
      t("Assist only knows these questions once you add them: save the lines below as {path} and restart Home Assistant. The answers are in English. Nothing needs to be exposed, and asking never changes anything.", { path: VOICE_SENTENCES_PATH })),
    yaml,
    copy,
  ]);
}

// ── Features tab (experimental toggles) ──────────────────────────────────────
// Enterprise-preview features gated behind settings toggles.
// All default to off and are labeled experimental.

// ── Tiers/Pro onboarding wizard ─────────────────────────────────────────────
// A dedicated walkthrough for what Free/Bright/Bright Pro/Pro each unlock and
// how to upgrade — 2026-09-09/10: "build a wizzard too" -> scoped to
// "Bright/Pro onboarding" when asked which of the existing three guided
// wizards (Maps setup, Calibration, the Lights builder tour) it should
// extend. It extends none of them: Maps/Calibration embed a real tool per
// step, and the Lights tour points at live map UI — this has no tool or
// on-map target to embed, it is pure explanation, so it is a short,
// all-informational step sequence instead, launched from the licence card
// rather than auto-opened (nobody needs an unsolicited tier pitch).
// ctx.state._tiersWizard = { step } while open; falsy means closed.
// i18n part: features
const TIERS_WIZARD_STEPS = [
  { n: 1, id: "free",    label: () => t("What's always free") },
  { n: 2, id: "ladder",  label: () => t("The tiers") },
  { n: 3, id: "upgrade", label: () => t("Upgrading") },
];

function _tiersWizardFooter(ctx, w, opts){
  opts = opts || {};
  const { el } = ctx.helpers;
  const bar = el("div",{style:"display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px"});
  const left = el("div",{});
  if (w.step > 1) {
    const b = el("button",{class:"btn inline"}, t("← Back"));
    b.addEventListener("click", ()=>{ w.step -= 1; ctx.actions.renderRooms(); });
    left.appendChild(b);
  }
  bar.appendChild(left);
  const nx = el("button",{class:"btn primary"}, opts.nextLabel || t("Next →"));
  nx.addEventListener("click", ()=>{
    if (opts.onNext) opts.onNext();
    else { w.step += 1; ctx.actions.renderRooms(); }
  });
  bar.appendChild(nx);
  return bar;
}

function _tiersWizardFree(ctx, w, isBright){
  const { el } = ctx.helpers;
  const wrap = el("div",{});
  wrap.appendChild(el("div",{class:"muted", style:"margin-bottom:10px;line-height:1.6"},
    isBright
      ? t("This install is PadSpan Bright — a lighter download for a household that only wants lighting from a map, not presence tracking. Every light shown room-by-room on a map and switched on or off from here is free, no key, forever. Placing each one exactly where it hangs needs a key — see below.")
      : t("This install is PadSpan HA. Presence tracking, Overview, Follow, Live Tracker, Occupancy, Calibration, mapping and everything else here is free, no key, forever.")));
  wrap.appendChild(el("div",{style:"padding:10px 12px;background:#0a1a12;border:1px solid #1a4228;border-radius:8px;font-size:13px;color:#94a3b8;line-height:1.6"},
    (isBright
      ? t("A PadSpan Pro key adds the paid features: light placement (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D house (Live Aboard), the wall screen and more.")
      : t("A PadSpan Pro key adds the paid features: light placement (fixture shapes and sizes, WLED, Showcase, Fit room), Forensics (which Bluetooth devices were near a scanner in any time window, with dwell time and CSV export), the 3D house (Live Aboard), the wall screen, Locate, Busy Times and more."))
    + " " + t("The free tier above is not a trial of anything — it stays free whether or not you ever add a key. To try PadSpan Pro on your own house first, a one-time 90-day free trial is available below, no card. When it ends, nothing you set up is deleted, and it all comes back as you left it when you buy.")));
  wrap.appendChild(_tiersWizardFooter(ctx, w));
  return wrap;
}

function _tiersWizardLadder(ctx, w, isBright){
  const { el } = ctx.helpers;
  const wrap = el("div",{});
  const row = (name, price, desc) => el("div",{style:"padding:10px 12px;margin-bottom:8px;background:#0a1a12;border:1px solid #1a4228;border-radius:8px"}, [
    el("div",{style:"display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"}, [
      el("span",{style:"font-weight:700;font-size:13px;color:#52b788"}, name),
      price ? el("span",{style:"font-size:11px;color:#94a3b8"}, price) : null,
    ].filter(Boolean)),
    el("div",{style:"font-size:12px;color:#94a3b8;margin-top:4px;line-height:1.5"}, desc),
  ]);
  if (isBright) {
    wrap.appendChild(row(t("PadSpan Bright (free)"), null,
      t("Place lights on a map, control them. No key, no time limit.")));
    // Bright Pro is retired from the end of December 15; Pro's key does the same here (editions.js).
    wrap.appendChild(row(brightProOpen() ? "PadSpan Bright Pro" : "PadSpan Pro", brightProOpen() ? BRIGHT_PRICE : proPrice(),
      t("Fixture shapes and sizes, WLED, Showcase, Fit room — light placement exactly where it hangs. Forensics needs presence tracking to report on, so it isn't part of this edition.")));
    wrap.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:6px;line-height:1.5"},
      t("Want presence tracking too? That's a separate, full download — PadSpan HA — not an upgrade of this one.")));
  } else {
    wrap.appendChild(row(t("PadSpan HA (free)"), null,
      t("Presence tracking and everything else in this app except the paid features below. No key, no time limit.")));
    wrap.appendChild(row("PadSpan Pro", proPrice(),
      t("Adds light placement (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D house, the wall screen, Forensics, Locate and Busy Times to this install.")));
    wrap.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:6px;line-height:1.5"},
      t("Only want lighting, not presence tracking? PadSpan Bright is a lighter, separate download built for exactly that.")));
  }
  wrap.appendChild(_tiersWizardFooter(ctx, w));
  return wrap;
}

function _tiersWizardUpgrade(ctx, w, isBright){
  const { el } = ctx.helpers;
  const wrap = el("div",{});
  wrap.appendChild(el("div",{class:"muted", style:"margin-bottom:10px;line-height:1.6"},
    t("A licence key is entered once, right on this install, at {path} — the same card shows this install's edition and tier, and how long a key has left.", { path: t("Settings → Features → PadSpan licence") })));
  const row = el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px"});
  const brightPro = isBright && brightProOpen();
  row.appendChild(el("a",{class:"btn inline", href: brightPro ? EDITIONS_URL : BUY_URL, target:"_blank", rel:"noopener",
    style:"border-color:#52b788;color:#a7f3d0;text-decoration:none"},
    brightPro ? t("Buy PadSpan Bright Pro — {price}", { price: BRIGHT_PRICE }) : t("Buy PadSpan Pro — {price}", { price: proPrice() })));
  wrap.appendChild(row);
  if (brightPro) {
    wrap.appendChild(el("div",{class:"muted",style:"font-size:12px;line-height:1.5"},
      t("Already have a Bright key and want the full app's Pro tier instead? The changeover is {price} — same key, same expiry, Forensics unlocks once you're on the full download.", { price: BRIGHT_UPGRADE_PRICE })));
  }
  wrap.appendChild(_tiersWizardFooter(ctx, w, { nextLabel: t("Done"), onNext: () => {
    if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("wizard_tiers_completed");
    ctx.state._tiersWizard = null;
    ctx.actions.renderRooms();
  } }));
  return wrap;
}

function _tiersWizard(ctx){
  const { el } = ctx.helpers;
  const w = ctx.state._tiersWizard;
  const isBright = String((ctx.state.settings || {}).edition || "full").toLowerCase() === "bright";

  // Opt-in usage report: which step was REACHED, once per distinct visit —
  // the same dedupe-on-render-not-on-step-change guard the Maps wizard uses,
  // so sitting on one step across re-renders never double-counts.
  if (w._telemetryStep !== w.step) {
    w._telemetryStep = w.step;
    if (ctx.actions.telemetryEvent) {
      if (w.step === 1) ctx.actions.telemetryEvent("wizard_tiers_step_free");
      else if (w.step === 2) ctx.actions.telemetryEvent("wizard_tiers_step_ladder");
      else if (w.step === 3) ctx.actions.telemetryEvent("wizard_tiers_step_upgrade");
    }
  }

  const root = el("div",{});
  const head = el("div",{class:"card", style:"margin-bottom:12px;border:1px solid #2d5a3d;background:#0f1a12"});
  const hrow = el("div",{style:"display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px"});
  const titleRow = el("div",{style:"display:flex;align-items:center;gap:8px"},
    [el("div",{style:"font-weight:700;font-size:15px;color:#52b788"}, t("Free, Bright, Bright Pro, Pro"))]);
  if (ctx.helpers.helpBtn) titleRow.appendChild(ctx.helpers.helpBtn("settings_tiers"));
  hrow.appendChild(titleRow);
  const closeBtn = el("button",{class:"btn inline", style:"font-size:12px"}, t("Exit"));
  closeBtn.addEventListener("click", ()=>{
    if (w.step < 3 && ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("wizard_tiers_exited_early");
    ctx.state._tiersWizard = null;
    ctx.actions.renderRooms();
  });
  hrow.appendChild(closeBtn);
  head.appendChild(hrow);
  const dots = el("div",{style:"display:flex;gap:6px;margin-top:12px"});
  const stepList = el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:8px"});
  for (const s of TIERS_WIZARD_STEPS){
    const isCurrent = s.n === w.step;
    dots.appendChild(el("div",{style:`flex:1;height:4px;border-radius:2px;background:${s.n < w.step ? "#52b788" : isCurrent ? "#5eead4" : "#1b3526"}`}));
    const chip = el("button",{class: "btn inline" + (isCurrent ? " primary" : ""), style:"font-size:11px;padding:3px 10px"},
      `${s.n}. ${s.label()}`);
    chip.addEventListener("click", ()=>{ w.step = s.n; ctx.actions.renderRooms(); });
    stepList.appendChild(chip);
  }
  head.appendChild(dots);
  head.appendChild(stepList);
  root.appendChild(head);

  const body = el("div",{class:"card"});
  if (w.step === 1) body.appendChild(_tiersWizardFree(ctx, w, isBright));
  else if (w.step === 2) body.appendChild(_tiersWizardLadder(ctx, w, isBright));
  else body.appendChild(_tiersWizardUpgrade(ctx, w, isBright));
  root.appendChild(body);
  return root;
}

// ── PadSpan licence ─────────────────────────────────────────────────────────
// The single place to see what this install is licensed for, enter a key, and
// find out where a key comes from. It exists because the only key field used to
// live inside the Forensics toggle: buying Pro to place lights meant enabling a
// recording feature you did not want in order to activate it. Every gate
// message in the product now names this card (editions.js LICENCE_PATH).
// One key, up to five homes (licence_homes.py; the licence server counts
// them). Loaded on request: opening Settings never calls the server.
const HOME_REFUSED = {
  activation_limit: () => t("This home isn't counted: the key is already on all its homes. Remove one below (from any home) and this one joins at its next daily check."),
  activation_rate: () => t("This home isn't counted: the key joined many new homes this month. It joins once the month is over."),
  homes_frozen: () => t("This home isn't counted: the key is paused for new homes. Reply to your licence email to sort it out."),
  removed: () => t("This home isn't counted: it was removed from the key. Remove another home below (from any home) or reply to your licence email to use it here."),
  needs_report: () => t("This home isn't counted: a licence's first two homes always count, and to use it on more than two, every home needs its usage report on (Settings \u2192 Tracking \u2192 Help improve PadSpan)."),
};
// A key on more than two homes needs every home's usage report on (0.38.163).
// The licence server decides and names the homes; these only say it.
function _homesDate(iso){
  const t = Date.parse(String(iso || ""));
  return isNaN(t) ? String(iso || "").slice(0, 10) : new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}
export function homesWarningText(s){
  const w = (s && s.license_homes_warning) || {};
  const labels = Array.isArray(w.off_labels) ? w.off_labels.filter(x => typeof x === "string" && x).join(", ") : "";
  if (s.license_home_status === "needs_all_reports") {
    if (s.telemetry_enabled === false) {
      return t("This home stopped using Pro because its own usage report is off, and every home on a key with more than 2 must keep it on. Turn it back on here (Settings → Tracking → Help improve PadSpan) and this home picks up again at its next check.");
    }
    return labels
      ? t("This home stopped using Pro because the usage report is off on another home on this key ({homes}). Turn it back on there and this home picks up again at its next check.", { homes: labels })
      : t("This home stopped using Pro because the usage report is off on another home on this key. Turn it back on there and this home picks up again at its next check.");
  }
  if (w.warning !== "reports_off") return "";
  const n = Number(s.license_homes_used) || 0;
  return (n > 2 ? t("This key is on {count} homes.", { count: n }) : t("This key is on more than 2 homes.")) + " " +
    t("Every home on a key with more than 2 must keep the usage report on.") + " " +
    // A home on PadSpan before 0.38.160 can't say its report is on: the server names it "(update PadSpan)".
    (/\(update PadSpan\)/.test(labels)
      ? t("The report is off on, or PadSpan needs updating on: {homes}.", { homes: labels })
      : t("The report is off on: {homes}.", { homes: labels || t("one of them") })) + " " +
    t("Unless it's turned back on by {date}, the homes beyond your first two stop using Pro.", { date: _homesDate(w.grace_until) });
}
// Asked before the usage report goes off on a home whose key is on more than two homes; "" = no question.
export function reportOffConfirmText(s){
  const n = Number((s && s.license_homes_used) || 0);
  if (!s || !s.pro_has_key || !(n > 2)) return "";
  // A grace already running (a report off on another home) has its own date.
  const w = s.license_homes_warning || {};
  const lead = t("This key is used on {count} homes. With more than 2, every home must keep the report on.", { count: n });
  return lead + " " + (w.warning === "reports_off" && w.grace_until
    ? t("If you turn it off here, the homes beyond your first two stop using Pro on {date} unless it's back on.", { date: _homesDate(w.grace_until) })
    : t("If you turn it off here, the homes beyond your first two stop using Pro within 14 days unless it's back on."));
}
function _licenceHomes(ctx, el, s){
  const box = el("div", { style: "margin-top:12px;padding-top:10px;border-top:1px solid #1f3a2a" });
  box.appendChild(el("div", { style: "font-weight:700;font-size:13px;color:#cbd5e1;margin-bottom:4px" }, t("Homes")));
  box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:8px" },
    t("One licence covers up to five homes (five Home Assistants). The first two always count. With more than two, every home must keep its usage report on (Settings → Tracking → Help improve PadSpan), which is how one licence's homes are seen together; if one turns it off, the key drops back to its first two homes after 14 days. A reinstalled or replaced Home Assistant takes the place of a home that hasn't checked in for 14 days, and one silent for 45 days frees its place by itself.")));
  if (HOME_REFUSED[s.license_home_status]) {
    box.appendChild(el("div", { style: "font-size:12px;color:#fbbf24;line-height:1.5;margin-bottom:8px" }, "\u26A0 " + HOME_REFUSED[s.license_home_status]()));
  }
  const homesWarn = homesWarningText(s);
  const warnBox = homesWarn
    ? box.appendChild(el("div", { class: "homes-reports-warning", style: "font-size:12px;color:#fbbf24;line-height:1.5;margin-bottom:8px" }, "\u26A0 " + homesWarn))
    : null;
  const list = el("div", {});
  const load = async (op, extra) => {
    list.textContent = t("Asking the licence server\u2026");
    let r;
    try { r = await ctx.actions.wsCall("padspan_ha/licence_homes", { op, ...(extra || {}) }); }
    catch (e) { list.textContent = t("Couldn't reach the licence server: {why}", { why: String((e && e.message) || e) }); return; }
    list.textContent = "";
    // The licence they share, said the same way in each of its homes.
    const L = r.licence || {};
    // Down to the first two homes (one just removed): the reports warning no longer applies.
    if (warnBox && r.homes.length <= (L.homes_free || 2)) warnBox.remove();
    list.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;margin-bottom:6px;line-height:1.5" },
      t("One licence{key}{owner}: {used} of {max} homes", { key: L.key_end ? " " + t("(key ending {end})", { end: L.key_end }) : "",
        owner: L.owner ? " " + t("for {owner}", { owner: L.owner }) : "", used: r.homes.length, max: r.homes_max }) +
      (r.frozen ? " \u00B7 " + t("paused for new homes") : "")));
    r.homes.forEach((h, i) => { h._place = i + 1; });
    for (const h of r.homes) {
      const name = h.label || (h.this ? t("This home") : t("A home"));
      const line = el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 0;border-top:1px solid #16271d;font-size:12px" });
      line.appendChild(el("span", { style: "color:#e2e8f0;font-weight:600;min-width:120px" }, name + (h.this ? " " + t("(this one)") : "")));
      line.appendChild(el("span", { style: "color:#94a3b8" },
        t("Home {place}", { place: h._place }) + " \u00B7 " + (h.last_seen ? t("last check {when}", { when: h.last_seen }) : t("not checked in yet")) +
        (h.version ? " \u00B7 " + h.version : "") +
        (r.homes.length > (L.homes_free || 2) ? " \u00B7 " + (h.reporting ? t("usage report on") : t("usage report off")) : "")));
      if (h.this) {
        line.appendChild(el("button", { class: "btn inline", type: "button", style: "font-size:11px", onclick: () => {
          const v = prompt(t("A name for this home (your other homes show it):"), h.label || "");
          if (v !== null) load("label", { label: v.trim().slice(0, 60) });
        } }, t("Rename")));
      }
      line.appendChild(el("button", { class: "btn inline", type: "button", style: "font-size:11px;margin-left:auto", onclick: () => {
        const what = h.this
          ? t("Remove this home? It stops being counted, and comes back at its next daily check if a place is free.")
          : t("Remove \"{name}\"? It stops being counted at its next check unless a place is free.", { name });
        if (confirm(what)) load("remove", { home_id: h.id });
      } }, t("Remove")));
      list.appendChild(line);
    }
  };
  const show = el("button", { class: "btn inline", type: "button", style: "font-size:12px",
    onclick: () => { show.remove(); load("list"); } }, t("Show this key's homes"));
  box.appendChild(show);
  box.appendChild(list);
  return box;
}

function _settingsLicence(ctx, el){
  const s = ctx.state.settings || {};
  const tier = String(s.tier || "free").toLowerCase();
  const edition = String(s.edition || "full").toLowerCase() === "bright" ? "PadSpan Bright" : "PadSpan HA";
  const hasKey = !!s.pro_has_key;
  const lapsed = s.pro_active === false;
  const exp = String(s.forensics_license_expires || "").slice(0, 10);
  const daysLeft = s.pro_days_left;
  const keyProd = String(s.license_tier || "").toLowerCase() === "bright" ? "PadSpan Bright Pro" : "PadSpan Pro";
  const expiringSoon = typeof daysLeft === "number" && daysLeft >= 0 && daysLeft <= 14;
  const isTrial = !!s.license_is_trial;

  const card = el("div", { class: "card", style: "margin-bottom:14px;border:1px solid #2d5a3d;background:#0f1a12" });
  card.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, [
    el("div", { style: "font-weight:700;font-size:14px;color:#52b788" }, t("PadSpan licence")),
    el("span", { style: "font-size:10px;padding:1px 7px;border-radius:999px;background:rgba(82,183,136,.14);color:#a7f3d0;font-weight:700;text-transform:uppercase" },
      edition + " \u00B7 " + (tier === "free" ? t("free") : tier)),
  ]));

  // Status — the backend's own answer, never re-derived here.
  let line, colour;
  if (!hasKey) {
    line = edition === "PadSpan Bright"
      ? t("No licence key on this install. Light placement, the 3D house and the wall screen are locked. Everything else is free and stays free.")
      : t("No licence key on this install. The paid features are locked: light placement, Forensics, the 3D house, the wall screen, Locate and Busy Times. Everything else is free and stays free.");
    colour = "#94a3b8";
  } else if (lapsed) {
    const what = isTrial ? t("Your 90-day trial") : t("The {name} licence", { name: keyProd });
    line = "\u26A0 " + (exp ? t("{what} expired on {date}", { what, date: exp }) : t("{what} expired", { what })) + " \u2014 " +
           (edition === "PadSpan Bright"
             ? t("light placement is read-only and the 3D house and the wall screen are off.")
             : t("light placement is read-only, Forensics has stopped recording, and the 3D house, the wall screen, Locate and Busy Times are off.")) +
           " " + (isTrial ? t("Nothing you set up is deleted: it all comes back as you left it when you buy.")
                          : t("Nothing you set up is deleted: it all comes back as you left it when you renew."));
    colour = "#fbbf24";
  } else if (typeof daysLeft === "number" && daysLeft < 0) {
    // Expired but inside the grace period: still working, not for long.
    const graceLeft = Math.max(1, 14 + daysLeft);   // days_left rounds down; the last day is still a day
    const what = isTrial ? t("Your trial") : t("The {name} licence", { name: keyProd });
    line = "\u26A0 " + (exp ? t("{what} expired on {date}", { what, date: exp }) : t("{what} expired", { what })) + " \u2014 " +
           (edition === "PadSpan Bright"
             ? tn(graceLeft, "light placement goes read-only and the 3D house and the wall screen switch off in {n} day.",
               "light placement goes read-only and the 3D house and the wall screen switch off in {n} days.")
             : tn(graceLeft, "light placement goes read-only, Forensics stops recording and the 3D house, the wall screen, Locate and Busy Times switch off in {n} day.",
               "light placement goes read-only, Forensics stops recording and the 3D house, the wall screen, Locate and Busy Times switch off in {n} days."));
    colour = "#fbbf24";
  } else if (isTrial) {
    line = "\u2713 " + t("Trial active") + " \u00B7 " + tn(daysLeft, "{n} day left", "{n} days left") +
           (exp ? " (" + exp + ")" : "") + ". " + t("Buy any time to keep Pro after it ends \u2014 nothing you set up is lost either way.");
    colour = expiringSoon ? "#fbbf24" : "#8ee5b4";
  } else if (expiringSoon) {
    line = "\u2713 " + t("{name} licensed", { name: keyProd }) + " \u00B7 " + tn(daysLeft, "renews in {n} day", "renews in {n} days") +
           (exp ? " (" + exp + ")" : "");
    colour = "#fbbf24";
  } else {
    // A lifetime key (the launch offer) is stored as expiring 2099-12-31.
    line = "\u2713 " + t("{name} licensed", { name: keyProd }) +
      (exp >= "2090" ? " \u00B7 " + t("lifetime") : exp ? " \u00B7 " + t("valid until {date}", { date: exp }) : "");
    colour = "#a7f3d0";
  }
  card.appendChild(el("div", { style: "font-size:12px;margin:8px 0 10px;line-height:1.5;color:" + colour }, line));

  const row = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" });

  const enterBtn = el("button", { class: "btn inline", style: "font-size:12px",
    onclick: async () => {
      const key = prompt(t("Enter your PadSpan licence key (PSPAN-XXXX-XXXX-XXXX-XXXX):"));
      if (!key || !key.trim()) return;
      enterBtn.disabled = true;
      try {
        const r = await ctx.actions.wsCall("padspan_ha/forensics_license_activate", { key: key.trim() });
        if (r && r.ok) {
          if (r.settings) ctx.state.settings = r.settings;
          ctx.toast(t("Licence activated"));
          ctx.actions.renderNav && ctx.actions.renderNav();
          ctx.actions.renderRooms();
        } else {
          ctx.toast((r && r.message) || t("That key was not accepted"), true);
        }
      } catch (e) {
        ctx.toast(t("Licence check failed: {why}", { why: ctx.helpers.errorText(e) }), true);
      } finally { enterBtn.disabled = false; }
    } }, hasKey ? t("Replace licence key") : t("Enter licence key"));
  row.appendChild(enterBtn);

  const canBuy = !hasKey || lapsed || isTrial;
  if (canBuy) {
    row.appendChild(el("a", { class: "btn inline", href: BUY_URL, target: "_blank", rel: "noopener",
      style: "font-size:12px;border-color:#52b788;color:#a7f3d0;text-decoration:none" },
      (lapsed ? t("Renew PadSpan Pro — {price}", { price: proPrice() }) : t("Buy PadSpan Pro — {price}", { price: proPrice() }))));
  }

  if (hasKey) {
    const revealBtn = el("button", { class: "btn inline", style: "font-size:12px",
      onclick: async () => {
        try {
          const r = await ctx.actions.wsCall("padspan_ha/forensics_license_reveal", {});
          revealBtn.replaceWith(el("div", { style: "font-size:11px;font-family:monospace;color:#a7f3d0" }, (r && r.key) || t("(none)")));
        } catch (e) { ctx.toast(t("Only a Home Assistant admin can reveal the licence key"), true); }
      } }, t("Show licence key"));
    row.appendChild(revealBtn);
  }
  const tourBtn = el("button", { class: "btn inline", style: "font-size:12px",
    onclick: () => { ctx.state._tiersWizard = { step: 1 }; ctx.actions.renderRooms(); } },
    t("What does each tier unlock?"));
  row.appendChild(tourBtn);
  card.appendChild(row);
  if (hasKey) card.appendChild(_licenceHomes(ctx, el, s));
  // Pro for life, under the buy button (editions.js: $89 until November 30,
  // then $168 until December 15); from then the two-year pass in its place.
  // A lifetime key never has the buy button, so never this either.
  if (canBuy) {
    card.appendChild(el("div", { style: "font-size:12px;margin-top:8px" },
      el("a", { href: BUY_URL, target: "_blank", rel: "noopener", style: "color:#a7f3d0;text-decoration:underline" },
        proLifetimeOpen() ? t("Or PadSpan Pro for life — {price}.", { price: proLifetimeWords() })
                          : t("Or two years for {price}.", { price: PRO_PASS_PRICE }))));
  }
  // The 90-day trial (views/trial_offer.js): the same card every paid wall
  // offers, shown here while there is no key at all. Its own Buy link is off —
  // this card already has one in the row above.
  if (!hasKey) {
    const trial = trialOfferFromCtx(ctx, "settings", { buy: false });
    if (trial) card.appendChild(trial);
  }
  // Free Pro (views/pro_invite.js), for an administrator: an invite this
  // install was sent stays here until it is answered, even after Overview's
  // card was put off; and with no key, the tester route to Pro.
  const _admin = !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
  if (_admin) {
    const invite = PRO.inviteCard(PRO.inviteHostFromCtx(ctx), { surface: "settings" });
    if (invite) card.appendChild(invite);
    if (!hasKey && s.tester_signed_up !== true && edition !== "PadSpan Bright" && PRO.testerOfferOn(s)) {
      const go = el("button", { class: "btn inline", "data-licence": "tester",
        style: "font-size:12px;margin-left:6px" }, t("Become a tester"));
      go.addEventListener("click", () => {
        ctx.state._testerFocus = true;
        ctx.state._testerScrolled = null;
        // Settings → Tracking; in Basic just the report's card, where the
        // sign-up is (views/focus.js), its back the licence card.
        FOCUS.openFocus(ctx, PART.usageReport);
      });
      card.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;margin-top:8px;line-height:1.55" },
        [PRO.testerCardBodyShort(), go]));
    }
  }

  card.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:10px;line-height:1.5" },
    edition === "PadSpan Bright"
      ? t("A PadSpan Pro key unlocks the paid features, among them light placement (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D house and the wall screen. A PadSpan Bright Pro key unlocks light placement only. A lapsed licence never deletes anything: what you set up comes back as you left it when you renew.")
      : t("A PadSpan Pro key unlocks the paid features, among them light placement (fixture shapes and sizes, WLED, Showcase, Fit room), Forensics, the 3D house, the wall screen, Locate and Busy Times. A PadSpan Bright Pro key unlocks light placement only. A lapsed licence never deletes anything: what you set up comes back as you left it when you renew.")));
  return card;
}

function _settingsFeatures(ctx, el){
  if (ctx.state._tiersWizard) return _tiersWizard(ctx);
  const settings = ctx.state.settings || {};
  const wrap = el("div",{});

  wrap.appendChild(_settingsLicence(ctx, el));

  const helpBtn = ctx.helpers.helpBtn;
  const headerCard = el("div",{class:"card",style:"border:1px solid #1a4228;background:#0f1a12;margin-bottom:14px"});
  headerCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
    el("div",{style:"font-weight:700;font-size:14px;color:#52b788;margin-bottom:6px"}, t("Experimental Features")),
    helpBtn("settings_features"),
  ]));
  headerCard.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5"},
    t("These features are under active development. Enable them to preview and help test. They may change or be removed in future releases. Feedback welcome.")));
  wrap.appendChild(headerCard);

  // Trackability Rating, Compass Ring Calibration and Replay Timeline used to
  // sit in this list. They were settings keys read by NOTHING outside this
  // screen: switching them on did nothing, ever. Removed 2026-08-24 along with
  // their schema entries, their defaults and their place in the usage report.
  // tests/test_dead_features.py fails if any of them comes back without an
  // implementation to go with it.
  const features = [
    {
      key: "walk_to_identify_enabled",
      label: t("Walk-to-Identify"),
      desc: t("Discover unknown BLE devices by walking into a room. PadSpan correlates signal strength changes with your reported location to isolate which device belongs to which person — no MAC addresses needed."),
    },
    {
      key: "radio_map_enabled",
      label: t("Radio Map"),
      desc: t("RSSI heatmap overlay on floor plan maps. Visualizes signal coverage from calibration data so you can see dead zones, strong corridors, and receiver reach at a glance."),
    },
    {
      key: "distortion_map_enabled",
      label: t("Signal distortion map"),
      desc: t("Shows where calibration predictions disagree with reality. Renders disagreement vectors on the map to reveal areas where walls, furniture, or interference cause positioning errors."),
    },
    {
      key: "roomplan_import_enabled",
      label: t("RoomPlan Import"),
      desc: t("Lets Mapping → Layout import an Apple RoomPlan scan exported as JSON (CapturedRoom or CapturedStructure), beside Sweet Home 3D files. Rooms come in as a candidate to review before anything is saved."),
    },
    {
      key: "vacuum_import_enabled",
      label: t("Robot Vacuum Import"),
      desc: t("Lets Mapping → Layout import a robot vacuum's map (Valetudo, Dreame or Xiaomi) as a new floor plan, with its rooms on a floor that has no plans yet. Admins only. A robot already linked keeps working while this is off."),
    },
    {
      key: "phone_wizard_enabled",
      label: t("Phone Setup Wizard"),
      desc: t("Shows a guided setup flow in the IRK Manager for adding phones and watches. Detects IRK Capture devices and walks through the pairing process."),
    },
    {
      key: "iphone_irk_guide",
      label: t("iPhone Setup Path"),
      desc: t("iPhones have no BLE Transmitter (that sensor is in the Android Companion App only). With this on, an iPhone in Overview's phone list and the IRK Manager's phone wizard (shown while this is on) walk through getting its IRK, adding it with Private BLE Device and checking it resolves. Android phones see the same steps as before."),
    },
    {
      key: "mac_rotation_bridging",
      label: t("MAC Rotation Bridging"),
      desc: t("When a device's Bluetooth address rotates, links the old and new addresses. Apple Find My tags (AirTags and \"works with Find My\" tags) you've named or followed are linked only when it's clear: the same kind of tag, the old address has stopped, and the scanners hear the new one in the same place. Other rotating devices are matched by what they advertise (company, services, Apple message type) — probabilistic, and may occasionally link the wrong device."),
    },
    {
      key: "apple_auto_classify",
      label: t("Apple Device Classification"),
      desc: t("Shows what sent an Apple Find My signal — an AirTag, a \"Find My accessory\" (another brand's tag, or AirPods), or an Apple device such as an iPhone, iPad or Mac — instead of just \"Find My\", in Devices, Bluetooth → Advertisements and a device's details. It can't tell an iPhone from an iPad or a Watch: nothing Apple sends over Bluetooth says which. Display-only — does not affect tracking or identity."),
    },
    {
      key: "rssi_capture_enabled",
      label: t("RSSI Vector Capture"),
      desc: t("Record the signal strength every scanner heard for every tracked device, poll by poll, alongside the room PadSpan chose — then export it and replay the same walk offline against changed settings. Adds a Record button to Health → Quick actions. Nothing is recorded until you start a session, and a session stops itself at 60 minutes or 25 MB."),
    },
  ];

  for(const f of features){
    const on = settings[f.key] === true;
    const card = el("div",{class:"card",style:"margin-bottom:10px"});
    const row = el("div",{style:"display:flex;align-items:center;justify-content:space-between;gap:12px"});
    const left = el("div",{style:"flex:1"});
    left.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"}, [
      el("span",{style:"font-weight:700;font-size:13px"}, f.label),
      el("span",{style:"font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(245,158,11,.15);color:#f59e0b;font-weight:600;text-transform:uppercase"}, t("experimental")),
    ]));
    left.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.4"}, f.desc));
    const toggle = el("input",{type:"checkbox",style:"width:18px;height:18px;accent-color:#52b788;cursor:pointer;flex-shrink:0"});
    toggle.checked = on;
    toggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ [f.key]: toggle.checked });
        ctx.toast(toggle.checked ? t("{name}: enabled", { name: f.label }) : t("{name}: disabled", { name: f.label }));
      } catch(e){ ctx.toast(t("Failed to save"), true); }
    });
    row.appendChild(left);
    row.appendChild(toggle);
    card.appendChild(row);
    wrap.appendChild(card);
  }

  // ── Forensics (privacy-sensitive, off by default — issue #55) ─────────────
  {
    const forensicsOn = settings.forensics_enabled === true;
    const card = el("div",{class:"card",style:"margin-top:14px;border-color:" + (forensicsOn ? "#b91c1c" : "#2d4a38")});

    card.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px"},[
      el("div",{class:"h2",style:"margin:0;color:#f87171"},t("Forensics")),
      el("span",{style:"font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(248,113,113,.15);color:#f87171;font-weight:600;text-transform:uppercase"}, t("privacy-sensitive")),
      helpBtn("forensics"),
    ]));
    card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      t("Records presence sessions for every Bluetooth device your scanners hear, so you can later ask \"which devices were near my home between X and Y?\" — e.g. after a break-in, or to spot an unknown tracker that keeps returning. Adds a Forensics tab while enabled. Samples every 60 seconds in Live mode.")));

    // Always-visible privacy warning
    card.appendChild(el("div",{style:
      "display:flex;gap:10px;padding:10px 14px;border-radius:6px;" +
      "background:linear-gradient(135deg,#450a0a,#7f1d1d);border:1px solid #b91c1c;margin-bottom:10px"
    },[
      el("span",{style:"font-size:18px"}, "⚠️"),
      el("div",{style:"flex:1"},[
        el("div",{style:"color:#fca5a5;font-weight:700;font-size:13px"},t("Privacy notice")),
        el("div",{style:"color:#fecaca;font-size:12px;margin-top:2px;line-height:1.5"},
          t("This continuously records which Bluetooth devices are near your scanners — including devices belonging to neighbours, visitors, and passers-by. Recordings stay on this Home Assistant instance and are never uploaded. Laws on collecting wireless identifiers vary by jurisdiction; you are responsible for using this lawfully. Results are investigative leads, not proof — a Bluetooth address is not a person, and most phones rotate their addresses.")),
      ]),
    ]));

    const toggle = el("input",{type:"checkbox",id:"forensicsToggle",style:"width:18px;height:18px;accent-color:#f87171;cursor:pointer"});
    toggle.checked = forensicsOn;
    toggle.addEventListener("change", async()=>{
      const live = ctx.state.dataMode === "live";
      // Forensics is a PadSpan PRO feature (tier "pro"): a Bright Pro key is
      // a valid key too, but not for this. Backend-owned answer, not the key.
      const hasKey = String(settings.tier || "") === "pro";
      if(toggle.checked){
        let msg = t("Enable Forensics recording?\n\nPadSpan will continuously record the presence of ALL nearby Bluetooth devices — including neighbours' and passers-by's — on this Home Assistant instance.\n\nYou are responsible for using this lawfully in your jurisdiction.");
        if(!live) msg += "\n\n" + t("Note: data mode is currently Sample — nothing will be recorded until you switch data mode to Live.");
        if(!confirm(msg)){
          toggle.checked = false;
          return;
        }
        if(!hasKey){
          // Forensics is a PadSpan Pro feature — ask for the licence key.
          const key = prompt(t("Forensics is a PadSpan Pro feature.\n\nEnter your licence key (PSPAN-XXXX-XXXX-XXXX-XXXX):"));
          if(!key || !key.trim()){
            toggle.checked = false;
            ctx.toast(t("A PadSpan Pro licence key is required for Forensics"), true);
            return;
          }
          toggle.disabled = true;
          try {
            const r = await ctx.actions.wsCall("padspan_ha/forensics_license_activate", { key: key.trim() });
            if(r?.ok){
              if(r.settings) ctx.state.settings = r.settings;
              ctx.toast(live
                ? t("PadSpan Pro activated — Forensics recording enabled")
                : t("PadSpan Pro activated — recording starts once data mode is Live"));
              ctx.actions.renderNav && ctx.actions.renderNav();
              ctx.actions.renderRooms();
            } else {
              toggle.checked = false;
              ctx.toast(r?.message || t("Key not valid for PadSpan Pro"), true);
            }
          } catch(e){
            toggle.checked = false;
            ctx.toast(t("Licence check failed: {why}", { why: ctx.helpers.errorText(e) }), true);
          } finally { toggle.disabled = false; }
          return;
        }
      }
      try {
        await ctx.actions.settingsSet({ forensics_enabled: toggle.checked });
        ctx.toast(toggle.checked
          ? (live
              ? t("Forensics recording enabled — the Forensics tab is now in the sidebar")
              : t("Forensics enabled — recording starts once data mode is Live; the Forensics tab is now in the sidebar"))
          : t("Forensics recording disabled (recorded data kept — delete it below if wanted)"));
        ctx.actions.renderRooms();
      } catch(e){ ctx.toast(t("Failed to save"), true); }
    });
    card.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      toggle,
      el("label",{for:"forensicsToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
        t("Enable presence-session recording")),
      el("span",{style:"font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(168,85,247,.15);color:#c4b5fd;font-weight:600;text-transform:uppercase"}, "pro"),
    ]));

    // Licence status line (key set via the enable flow's activation prompt)
    {
      // The key itself is no longer sent to the browser — status comes from
      // the backend's own gate (pro_active), so what's shown here and what is
      // enforced can never disagree. Use "Show licence key" to read it back
      // when moving the licence to another install (admins only).
      if(settings.pro_has_key){
        const licExp = String(settings.forensics_license_expires || "").slice(0,10);
        const daysLeft = settings.pro_days_left;
        const lapsed = settings.pro_active === false;
        const expiringSoon = typeof daysLeft === "number" && daysLeft >= 0 && daysLeft <= 14;
        // Name the product the key is for: a Bright Pro key licenses the
        // lighting product, and this card should not call it PadSpan Pro.
        const _prod = String(settings.license_tier || "").toLowerCase() === "bright" ? "PadSpan Bright Pro" : "PadSpan Pro";
        const what = t("The {name} licence", { name: _prod });
        const line = lapsed
          ? "⚠ " + (licExp ? t("{what} expired on {date}", { what, date: licExp }) : t("{what} expired", { what })) + " — " +
            t("Forensics has stopped recording. What it recorded stays searchable for its retention period, and recording starts again when you renew.")
          : expiringSoon
          ? "✓ " + t("{name} licensed", { name: _prod }) + " · " + tn(daysLeft, "renews in {n} day", "renews in {n} days") + (licExp ? ` (${licExp})` : "")
          : "✓ " + t("{name} licensed", { name: _prod }) + (licExp >= "2090" ? " · " + t("lifetime") : licExp ? " · " + t("valid until {date}", { date: licExp }) : "");
        card.appendChild(el("div",{class:"muted",
          style:`font-size:11px;margin-bottom:6px;color:${lapsed ? "#fbbf24" : expiringSoon ? "#fbbf24" : "#a7f3d0"}`}, line));
        const revealBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:2px 8px;margin-bottom:10px",
          onclick: async()=>{
            try{
              const r = await ctx.actions.wsCall("padspan_ha/forensics_license_reveal", {});
              revealBtn.replaceWith(el("div",{class:"muted",
                style:"font-size:11px;margin-bottom:10px;font-family:monospace;color:#a7f3d0"}, r?.key || t("(none)")));
            }catch(e){ ctx.toast(t("Only a Home Assistant admin can reveal the licence key"), true); }
          }}, t("Show licence key"));
        card.appendChild(revealBtn);
      } else {
        card.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:10px"},
          t("Requires a PadSpan Pro licence key. Enter one in PadSpan licence at the top of this tab, or you will be asked for it when enabling.")));
      }
    }

    // Retention select (auto-save on change)
    const RETENTION_CHOICES = [7, 14, 30, 60, 90];
    const curRet = RETENTION_CHOICES.includes(Number(settings.forensics_retention_days))
      ? Number(settings.forensics_retention_days) : 14;
    const retSel = el("select",{style:"width:160px;background:#0a150e;color:#e2e8f0;border:1px solid #2d5a3d;border-radius:6px;padding:4px 8px;font-size:13px"});
    for(const d of RETENTION_CHOICES){
      const o = el("option",{value:String(d)}, d === 14 ? t("14 days (default)") : tn(d, "{n} day", "{n} days"));
      if(d === curRet) o.selected = true;
      retSel.appendChild(o);
    }
    retSel.addEventListener("change", async()=>{
      const v = Number(retSel.value);
      if(!RETENTION_CHOICES.includes(v)) return;
      try {
        await ctx.actions.settingsSet({ forensics_retention_days: v });
        ctx.toast(tn(v, "Forensics retention set to {n} day", "Forensics retention set to {n} days"));
      } catch(e){ ctx.toast(t("Failed to save"), true); }
    });
    card.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px"},[
      el("div",{style:"font-size:13px;color:#a7f3d0;min-width:130px"},t("Keep sessions for")),
      retSel,
    ]));

    // Stats line + delete button
    const statsDiv = el("div",{class:"muted",style:"font-size:11px;margin-bottom:8px"},t("Loading stats…"));
    (async()=>{
      try {
        const s = await ctx.actions.wsCall("padspan_ha/forensics_stats");
        const oldest = s?.oldest_ts ? new Date(s.oldest_ts * 1000).toLocaleDateString() : null;
        const addrs = s?.addr_count || 0, sessions = s?.session_count || 0;
        statsDiv.textContent = tn(addrs, "{n} address", "{n} addresses") + " · " + tn(sessions, "{n} session recorded", "{n} sessions recorded") +
          (oldest ? " · " + t("oldest {date}", { date: oldest }) : "");
      } catch(e){ statsDiv.textContent = ""; }
    })();
    card.appendChild(statsDiv);

    const delBtn = el("button",{class:"btn",style:"background:#991b1b;border-color:#991b1b"},t("Delete all recorded data"));
    delBtn.addEventListener("click", async()=>{
      if(!confirm(t("Delete ALL recorded forensics sessions? This cannot be undone.\n\nNote: the 'Possible' tier in the Forensics tab comes from the device first/last-seen history (Devices → By Room) and is not affected by this delete."))) return;
      if(!confirm(t("Are you sure? Every recorded presence session will be permanently deleted."))) return;
      delBtn.disabled = true; delBtn.textContent = t("Deleting…");
      try {
        const r = await ctx.actions.wsCall("padspan_ha/forensics_clear");
        const removed = r?.removed ?? 0;
        ctx.toast(tn(removed, "Deleted forensics data for {n} address", "Deleted forensics data for {n} addresses"));
        statsDiv.textContent = tn(0, "{n} address", "{n} addresses") + " · " + tn(0, "{n} session recorded", "{n} sessions recorded");
      } catch(e){ ctx.toast(t("Delete failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
      finally { delBtn.disabled = false; delBtn.textContent = t("Delete all recorded data"); }
    });
    card.appendChild(delBtn);

    wrap.appendChild(card);
  }

  return wrap;
}
// i18n part: -

// ── The Atlas's outdoor weather (views/atlas_weather.js) ─────────────────────
// Rain or snow around the house on the Atlas. Every control saves on its own
// the moment it changes, straight to the wire like the emergency button
// (settingsSet would re-render the page and drop unsaved edits elsewhere);
// the Atlas picks it up at its next settings refresh.
// i18n part: atlas
function _atlasWeatherSection(ctx, el, settings){
  const box = el("div",{"data-focus-part":"atlas_weather",style:"margin-top:14px;padding-top:12px;border-top:1px solid #1e3a2a"});
  box.appendChild(el("div",{style:"font-weight:600;font-size:14px;color:#e2e8f0;margin-bottom:4px"},t("🌧️ Outdoor weather")));
  box.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-bottom:8px"},
    t("Rain or snow drawn around the house on the Atlas, never over a room or between floors, only while it is actually raining or snowing. A rain sensor alone shows light rain, and none while the weather entity says the sky is clear (dew wets a rain sensor too); heavy rain needs a rainfall warning or the weather entity saying “pouring”, heavy snow a snowfall warning. PadSpan Pro or PadSpan Bright Pro animates it; the free map shows it still.")));
  const note = el("div",{style:"font-size:11px;color:#94a3b8;margin:6px 0 0"}, t("Saves as soon as you change it. No restart needed."));
  const save = async (key, value, undo) => {
    try {
      const r = await ctx.actions.wsCall("padspan_ha/settings_set", { [key]: value });
      if (r && r.settings && ctx.state) ctx.state.settings = r.settings;
      note.textContent = t("Saved — the Atlas shows it at its next refresh.");
    } catch (e) {
      if (undo) undo();
      ctx.toast(t("Could not save: {why}", { why: ctx.helpers.errorText(e) }), true);
    }
  };

  const onRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer"});
  const onCb = el("input",{type:"checkbox"});
  onCb.checked = settings.atlas_weather_enabled !== false;
  onRow.appendChild(onCb);
  onRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, t("Show rain and snow on the Atlas")));
  onCb.addEventListener("change", ()=>{ const want = onCb.checked; save("atlas_weather_enabled", want, ()=>{ onCb.checked = !want; }); });
  box.appendChild(onRow);

  const states = (ctx.hass && ctx.hass.states) || {};
  const entities = ctx.hass && ctx.hass.entities;
  const nameOf = (eid) => { const n = states[eid] && states[eid].attributes && states[eid].attributes.friendly_name; return n ? `${n} (${eid})` : eid; };
  const ids = Object.keys(states).sort();
  const picker = (label, key, blank, offered) => {
    const cur = String(settings[key] || "");
    // A Zigbee device's duplicate copy is left out, and said when it is the one chosen (views/zigbee_twins.js).
    const { ids: list, hidden, via } = TW ? TW.dropDuplicates(offered, settings, [cur]) : { ids: offered, hidden: 0 };
    const sel = document.createElement("select");
    sel.className = "select";
    sel.style.maxWidth = "100%";
    sel.appendChild(el("option",{value:""}, blank));
    for (const eid of (cur && !list.includes(cur) ? [cur, ...list] : list)) sel.appendChild(el("option",{value:eid}, nameOf(eid)));
    sel.value = cur;
    sel.addEventListener("change", ()=>{ const want = sel.value; save(key, want, ()=>{ sel.value = cur; }); });
    box.appendChild(el("div",{style:"display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:8px"},[
      el("span",{style:"color:#cbd5e1;font-size:13px;min-width:130px"}, label), sel,
    ]));
    const hid = TW && TW.hiddenNoteEl(hidden, via);
    if (hid) box.appendChild(hid);
    const twin = TW && TW.duplicateWarningEl(cur, settings, states, (use) => {
      TW.useTwin(ctx.actions.wsCall, cur, use).then((r) => {
        if (r && r.settings && ctx.state) ctx.state.settings = r.settings;
        if (!list.includes(use)) sel.appendChild(el("option",{value:use}, nameOf(use)));
        sel.value = use; twin.remove(); note.textContent = TW.usedNow(nameOf(use));
      }, (e) => ctx.toast(TW.useFailed(ctx.helpers.errorText(e)), true));
    }, nameOf);
    if (twin) box.appendChild(twin);
  };
  // Only actual rain sensors (atlas_weather.js rainSensorIds).
  const rainIds = WX ? WX.rainSensorIds(states, entities) : [];
  const firstWx = WX ? WX.firstWeatherEntity(states) : "";
  const warnIds = WX ? WX.warningEntities({}, states, entities) : [];
  // The detected ones first, then anything else that calls itself a warning
  // or an alert — never one of the house's alarms (atlas_weather.js warningPickerIds).
  const warnList = WX ? WX.warningPickerIds(states, entities) : [];
  picker(t("Rain sensor"), "atlas_weather_rain_entity", t("None — use the weather entity"), rainIds);
  // One that has stopped reporting counts as no reading (atlas_weather.js).
  const rainSince = WX ? WX.rainSensorStaleSince(String(settings.atlas_weather_rain_entity || ""), states, entities, Date.now()) : null;
  if (rainSince !== null) {
    box.appendChild(el("div",{style:"font-size:11px;color:#fbbf24;line-height:1.5;margin-top:4px"},
      t("This sensor hasn't reported since {date}. Using the weather forecast instead.", { date: new Date(rainSince).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) })));
  }
  // One that has said wet for hours under a dry forecast is stuck (atlas_weather.js).
  const stuck = WX && rainSince === null ? WX.rainSensorStuckSince(WX.weatherSettingsFrom(settings), states, entities, Date.now()) : null;
  if (stuck !== null) {
    box.appendChild(el("div",{style:"font-size:11px;color:#fbbf24;line-height:1.5;margin-top:4px"},
      t("The rain sensor has said wet for over {hours} hours while the forecast says dry, so it is ignored until it dries. It may need cleaning.", { hours: WX.STUCK_H })));
  }
  picker(t("Weather entity"), "atlas_weather_condition_entity",
    firstWx ? t("Automatic — {name}", { name: nameOf(firstWx) }) : t("Automatic — none found (no weather shows)"), ids.filter(eid => eid.startsWith("weather.")));
  picker(t("Weather warnings"), "atlas_weather_warning_entity",
    warnIds.length ? t("Automatic — {count} found", { count: warnIds.length }) : t("Automatic — none found"), warnList);
  // An alarm picked before the list left it out is still stored: the Atlas
  // ignores it and finds warnings itself (atlas_weather.js chosenWarning).
  const curWarn = String(settings.atlas_weather_warning_entity || "");
  if (WX && curWarn && WX.isHouseAlarm(curWarn, states)) {
    box.appendChild(el("div",{style:"font-size:11px;color:#fbbf24;line-height:1.5;margin-top:4px"},
      t("{name} is an alarm (a leak, smoke, gas or CO detector), not a weather warning, so the Atlas ignores it and finds warnings on its own. Pick a warning above, or Automatic.", { name: nameOf(curWarn) })));
  }

  const k = Number(settings.atlas_weather_strength);
  const start = Number.isFinite(k) ? Math.max(0.5, Math.min(1.5, k)) : 1;
  const range = el("input",{type:"range", min:"0.5", max:"1.5", step:"0.1"});
  range.value = String(start);
  const val = el("span",{style:"color:#e2e8f0;font-size:13px;font-variant-numeric:tabular-nums"}, `${start.toFixed(1)}×`);
  range.addEventListener("input", ()=>{ val.textContent = `${Number(range.value).toFixed(1)}×`; });
  range.addEventListener("change", ()=>{ save("atlas_weather_strength", Number(range.value), ()=>{ range.value = String(start); val.textContent = `${start.toFixed(1)}×`; }); });
  box.appendChild(el("div",{style:"display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:8px"},[
    el("span",{style:"color:#cbd5e1;font-size:13px;min-width:130px"}, t("Strength")), range, val,
  ]));
  box.appendChild(note);
  return box;
}

// ── The Atlas's 3D house (views/live_aboard.js) ──────────────────────────────
// Live Aboard (docs/IDEA_ATLAS_3D_HOUSE.md), normally off: the master switch
// and one line on what it adds, and once it is on, Quality, North, Rain and
// snow (on by default; it follows Outdoor weather) and the Showcase look (off
// by default). Each saves on its own the moment it changes, like the weather
// box above; the Atlas picks it up at its next settings refresh.
const _ATLAS_3D_QUALITY = [["auto", () => t("Auto — picked for this screen")], ["low", () => t("Low — for wall tablets and phones")],
                           ["high", () => t("High — sun shadows and more lamps")]];
// Live Aboard's look (atlas_3d_look): the Atlas's colours, rooms and floor
// numbers (its Showcase theme, or the plain Atlas), its own dark look, or
// Studio: its own colours under soft light, a sky from the sun and a stage.
const _ATLAS_3D_LOOK = [["atlas", () => t("Same as the Atlas")], ["own", () => t("Live Aboard's own")], ["studio", () => t("Studio — soft light and sky")]];
// How long the sidebar's Live Aboard waits untouched before it goes back to its home view.
const _ATLAS_3D_IDLE = [[0, () => t("Off")], [30, () => t("After 30 s")], [60, () => t("After 1 min")], [300, () => t("After 5 min")]];
// What may fly the sidebar's Live Aboard (ws_settings.DIRECTOR_DOMAINS, DIRECTOR_MAX).
const _DIRECTOR_DOMAINS = ["event", "binary_sensor", "alarm_control_panel"];
const _DIRECTOR_MAX = 12;
function _atlas3dDirector(ctx, el, settings, save, row){
  const states = (ctx.hass && ctx.hass.states) || {};
  const admin = !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
  const nameOf = (eid) => { const a = states[eid] && states[eid].attributes; return a && a.friendly_name ? `${a.friendly_name} (${eid})` : eid; };
  let list = (Array.isArray(settings.atlas_3d_director) ? settings.atlas_3d_director : [])
    .filter(t => t && typeof t.entity === "string").map(t => ({ entity: t.entity, camera: typeof t.camera === "string" ? t.camera : "" }));
  const wrap = el("div",{"data-la3d-director":""});
  const rows = el("div",{});
  const pickT = document.createElement("select");
  const pickC = document.createElement("select");
  for (const sel of [pickT, pickC]) { sel.className = "select"; sel.style.width = "auto"; sel.style.maxWidth = "100%"; sel.disabled = !admin; }
  pickT.appendChild(el("option",{value:""}, t("Pick a doorbell, door, sensor or alarm…")));
  for (const eid of Object.keys(states).filter(e => _DIRECTOR_DOMAINS.includes(e.split(".")[0]) && !(TW && TW.duplicateOf(e, settings))).sort()) pickT.appendChild(el("option",{value:eid}, nameOf(eid)));
  pickC.appendChild(el("option",{value:""}, t("No camera")));
  for (const eid of Object.keys(states).filter(e => e.startsWith("camera.")).sort()) pickC.appendChild(el("option",{value:eid}, nameOf(eid)));
  const add = el("button",{class:"btn inline"}, t("Add"));
  add.disabled = !admin;
  if (!admin) add.title = t("Only an administrator can change this");
  const keep = (next) => { const was = list; list = next; paint(); save("atlas_3d_director", next, ()=>{ list = was; paint(); }); };
  function paint(){
    while (rows.firstChild) rows.removeChild(rows.firstChild);
    if (!list.length) rows.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;margin-top:6px"}, t("Off: nothing picked.")));
    for (const trig of list) {
      const x = el("button",{class:"btn inline",title:t("Remove")}, "✕");
      x.disabled = !admin;
      x.addEventListener("click", ()=> keep(list.filter(o => o.entity !== trig.entity)));
      rows.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:#e2e8f0"},
        [el("span",{}, nameOf(trig.entity) + (trig.camera ? ` → 📷 ${nameOf(trig.camera)}` : "")), x]));
    }
    add.disabled = !admin || list.length >= _DIRECTOR_MAX;
  }
  add.addEventListener("click", ()=>{
    const e = pickT.value;
    if (!e || list.some(o => o.entity === e)) return;
    keep([...list, { entity: e, camera: pickC.value || "" }]);
    pickT.value = ""; pickC.value = "";
  });
  paint();
  wrap.appendChild(row(t("Fly to when it goes off"), [pickT, pickC, add]));
  wrap.appendChild(rows);
  wrap.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin:4px 0 0 140px;line-height:1.5"},
    t("On the sidebar, Live Aboard flies to a doorbell that rings, a door that opens, a sensor that goes off or an alarm that is triggered, shows a card (with the camera's snapshot if you picked one), then goes back to its home view after 20 s. If someone touched the screen in the last 20 s, or a card, Edit or Furnish is open, only the card shows.")));
  // People and tags (settings.atlas_3d_director_people): who, and the rooms
  // that count ([] = any room, or a person arriving home).
  const snapObjs = (((ctx.state && ctx.state.live && ctx.state.live.snapshot) || {}).objects || {}).list;
  const tagName = new Map();
  for (const o of Array.isArray(snapObjs) ? snapObjs : []) {
    const k = o && String(o.key || o.address || "");
    if (k && ["ble", "private_ble", "ibeacon"].includes(o.kind) && (o.user_label || o.identified)) tagName.set("beacon:" + k, String(o.user_label || o.private_ble_name || o.name || k));
  }
  const whoOf = (k) => (k.startsWith("person.") ? nameOf(k) : t("{name} (tag)", { name: tagName.get(k) || k.slice("beacon:".length) }));
  let people = (Array.isArray(settings.atlas_3d_director_people) ? settings.atlas_3d_director_people : [])
    .filter(w => w && typeof w.key === "string").map(w => ({ key: w.key, rooms: Array.isArray(w.rooms) ? w.rooms.filter(r => typeof r === "string") : [] }));
  const prows = el("div",{"data-la3d-director-people":""});
  const pickP = document.createElement("select");
  const pickR = document.createElement("select");
  for (const sel of [pickP, pickR]) { sel.className = "select"; sel.style.width = "auto"; sel.style.maxWidth = "100%"; sel.disabled = !admin; }
  pickP.appendChild(el("option",{value:""}, t("Pick a person or tag…")));
  for (const eid of Object.keys(states).filter(e => e.startsWith("person.")).sort()) pickP.appendChild(el("option",{value:eid}, nameOf(eid)));
  for (const [k, n] of [...tagName].sort((a, b) => a[1].localeCompare(b[1]))) pickP.appendChild(el("option",{value:k}, t("{name} (tag)", { name: n })));
  pickR.appendChild(el("option",{value:""}, t("Any room, or arriving home")));
  for (const r of Object.keys((ctx.state && ctx.state.model && ctx.state.model.room_geometry_m) || {}).sort()) pickR.appendChild(el("option",{value:r}, r));
  const addP = el("button",{class:"btn inline"}, t("Add"));
  addP.disabled = !admin;
  if (!admin) addP.title = t("Only an administrator can change this");
  const keepP = (next) => { const was = people; people = next; paintP(); save("atlas_3d_director_people", next, ()=>{ people = was; paintP(); }); };
  function paintP(){
    while (prows.firstChild) prows.removeChild(prows.firstChild);
    if (!people.length) prows.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;margin-top:6px"}, t("Off: nobody picked.")));
    for (const w of people) {
      const x = el("button",{class:"btn inline",title:t("Remove")}, "✕");
      x.disabled = !admin;
      x.addEventListener("click", ()=> keepP(people.filter(o => o.key !== w.key)));
      prows.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:#e2e8f0"},
        [el("span",{}, `${whoOf(w.key)} → ${w.rooms.length ? w.rooms.join(", ") : t("any room, or arriving home")}`), x]));
    }
    addP.disabled = !admin || (people.length >= _DIRECTOR_MAX && !people.some(o => o.key === pickP.value));
  }
  pickP.addEventListener("change", paintP);
  addP.addEventListener("click", ()=>{
    const k = pickP.value, r = pickR.value;
    if (!k) return;
    const had = people.find(o => o.key === k);
    // A room joins the rooms already picked; "any" stands for every room.
    const rooms = !r ? [] : had && had.rooms.length ? (had.rooms.includes(r) ? had.rooms : [...had.rooms, r].slice(0, _DIRECTOR_MAX)) : [r];
    keepP(had ? people.map(o => (o.key === k ? { key: k, rooms } : o)) : [...people, { key: k, rooms }]);
    pickP.value = ""; pickR.value = "";
  });
  paintP();
  wrap.appendChild(row(t("Fly to when they arrive"), [pickP, pickR, addP]));
  wrap.appendChild(prows);
  wrap.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin:4px 0 0 140px;line-height:1.5"},
    t("It can also fly to a person or tag you pick when they go into a room you pick (or, with no room picked, any room, or a person arriving home), with the same card and the same rules, at most once every 2 minutes each. Only people and tags Live Aboard shows (Views → Show people, Show tags & scanners) are flown to. Nobody picked: off.")));
  return wrap;
}
/** Settings → AI (2026-10-27: "group AI power features into a section
 *  called AI"): the AI Task that reads for PadSpan, the switches for what it
 *  reads, and what is coming. An administrator's settings (ws_settings: a
 *  cloud AI sends what it reads out of the house). */
// i18n part: ai
function _settingsAI(ctx, el){
  const settings = ctx.state.settings || {};
  const wrap = el("div",{});
  const note = el("div",{style:"font-size:11px;color:#94a3b8;margin:8px 0 0"}, t("Saves as soon as you change it."));
  const save = async (key, value, undo) => {
    try {
      const r = await ctx.actions.wsCall("padspan_ha/settings_set", { [key]: value });
      if (r && r.settings && ctx.state) ctx.state.settings = r.settings;
      note.textContent = t("Saved.");
      return true;
    } catch (e) {
      if (undo) undo();
      ctx.toast(t("Could not save: {why}", { why: ctx.helpers.errorText(e) }), true);
      return false;
    }
  };
  const head = el("div",{class:"card",style:"border:1px solid #1a4228;background:#0f1a12;margin-bottom:14px"});
  head.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
    el("div",{style:"font-weight:700;font-size:14px;color:#52b788;margin-bottom:6px"}, t("AI power features")),
    ctx.helpers.helpBtn ? ctx.helpers.helpBtn("settings_ai") : null,
  ]));
  head.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5"},
    t("PadSpan can use an AI you have set up in Home Assistant (an AI Task) to fill things in for you. It only reads what you give it, when you ask, and keeps nothing. A cloud AI (OpenAI, Google, Anthropic, Home Assistant Cloud) sends it out of the house; a local one (like Ollama) keeps it home.")));
  wrap.appendChild(head);

  // The AI Task (ws_house3d_photo.py reads it): one for everything here.
  const card = el("div",{class:"card","data-focus-part":"ai_task",style:"margin-bottom:14px"});
  card.appendChild(el("div",{class:"h2"}, t("Your AI")));
  const aiStates = (ctx.hass && ctx.hass.states) || {};
  const aiCur = String(settings.atlas_3d_ai_task_entity || "");
  const aiIds = Object.keys(aiStates).filter(e => e.startsWith("ai_task.")).sort();
  const aiSel = document.createElement("select");
  aiSel.className = "select";
  aiSel.style.width = "auto";
  aiSel.style.maxWidth = "100%";
  aiSel.appendChild(el("option",{value:""}, t("None")));
  for (const eid of (aiCur && !aiIds.includes(aiCur) ? [aiCur, ...aiIds] : aiIds)) {
    const n = aiStates[eid] && aiStates[eid].attributes && aiStates[eid].attributes.friendly_name;
    aiSel.appendChild(el("option",{value:eid}, n ? `${n} (${eid})` : eid));
  }
  aiSel.value = aiCur;
  let aiLast = aiCur;
  let pbRefresh = null;            // Build from plans: the row asks the server again when the AI Task changes
  aiSel.addEventListener("change", ()=>{ const want = aiSel.value; save("atlas_3d_ai_task_entity", want, ()=>{ aiSel.value = aiLast; }).then(ok=>{ if (ok) { aiLast = want; syncBackup(); if (pbRefresh) pbRefresh(); } }); });
  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap"},
    [el("span",{style:"font-size:13px;color:#a7f3d0;min-width:130px"}, t("AI Task")), aiSel]));
  card.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-top:6px"}, aiIds.length
    ? t("Pick one whose model can read pictures (a vision model). Needs Home Assistant 2025.8 or newer.")
    : t("No AI Task in Home Assistant yet. Add an AI integration with a vision model (like Ollama, or a cloud one), then pick its AI Task here. Needs Home Assistant 2025.8 or newer.")));
  // The backup AI Task (ws_house3d_photo.ask_ai): the same list, the main one hidden; none until chosen.
  const bkCur = String(settings.atlas_3d_ai_task_backup_entity || "");
  const bkSel = document.createElement("select");
  bkSel.className = "select";
  bkSel.style.width = "auto";
  bkSel.style.maxWidth = "100%";
  bkSel.setAttribute("data-ai-backup", "");
  bkSel.appendChild(el("option",{value:""}, t("None")));
  for (const eid of (bkCur && !aiIds.includes(bkCur) ? [bkCur, ...aiIds] : aiIds)) {
    const n = aiStates[eid] && aiStates[eid].attributes && aiStates[eid].attributes.friendly_name;
    bkSel.appendChild(el("option",{value:eid}, n ? `${n} (${eid})` : eid));
  }
  bkSel.value = bkCur;
  // A new main one is no backup to itself (the server clears a backup the same as the main).
  function syncBackup(){ for (const o of Array.from(bkSel.children)) { const v = o.getAttribute("value"); o.hidden = !!v && v === aiSel.value; } if (bkSel.value && bkSel.value === aiSel.value) { bkSel.value = ""; bkLast = ""; } }
  let bkLast = bkCur;
  bkSel.addEventListener("change", ()=>{ const want = bkSel.value; save("atlas_3d_ai_task_backup_entity", want, ()=>{ bkSel.value = bkLast; }).then(ok=>{ if (ok) bkLast = want; }); });
  syncBackup();
  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px"},
    [el("span",{style:"font-size:13px;color:#a7f3d0;min-width:130px"}, t("Backup AI task")), bkSel]));
  card.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-top:6px"},
    t("Used when the main one can't be reached, e.g. a computer that's away.")));
  // This month's AI reads (ai_usage.py, experimental): asked only by an administrator, as the command is.
  if (ctx.hass && ctx.hass.user && ctx.hass.user.is_admin) card.appendChild(_aiUsageRow(ctx, el, save));
  wrap.appendChild(card);

  // What it reads: a switch each; what is not built yet says so.
  const feats = el("div",{class:"card",style:"margin-bottom:14px"});
  feats.appendChild(el("div",{class:"h2"}, t("What it does for you")));
  const sw = (key, label, desc, on, soon) => {
    const r = el("label",{style:`display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:1px solid #1e3a2a;cursor:${soon ? "default" : "pointer"}`});
    const cb = el("input",{type:"checkbox", style:"margin-top:3px"});
    cb.checked = !!on; cb.disabled = !!soon;
    if (!soon) cb.addEventListener("change", ()=>{ const want = cb.checked; save(key, want, ()=>{ cb.checked = !want; }); });
    r.appendChild(cb);
    r.appendChild(el("div",{},[
      el("div",{style:"font-size:13px;color:#e2e8f0;font-weight:600"}, [label,
        soon ? el("span",{style:"margin-left:8px;font-size:10px;font-weight:700;letter-spacing:.06em;color:#fbbf24;border:1px solid rgba(251,191,36,.45);border-radius:999px;padding:0 7px"}, t("COMING SOON")) : null]),
      el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-top:2px"}, desc),
    ]));
    return r;
  };
  // The master switch over every AI map-building feature (2026-11, experimental, off by default): today's
  // stair finder and the Plans tool in Live Aboard's Edit bar. Off hides them all; its two rows show only while on.
  const chip = el("span",{style:"margin-left:8px;font-size:10px;font-weight:700;letter-spacing:.06em;color:#fbbf24;border:1px solid rgba(251,191,36,.45);border-radius:999px;padding:0 7px"}, t("EXPERIMENTAL"));
  const master = el("label",{"data-ai-plans":"",style:"display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:1px solid #1e3a2a;cursor:pointer"});
  const masterCb = el("input",{type:"checkbox", style:"margin-top:3px"});
  masterCb.checked = settings.ai_plans_enabled === true;
  master.appendChild(masterCb);
  master.appendChild(el("div",{},[
    el("div",{style:"font-size:13px;color:#e2e8f0;font-weight:600"}, [t("AI map-building research (experimental)"), chip]),
    el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-top:2px"},
      t("Research feature. The AI suggests; you check every item, and nothing is saved until you accept it. It never changes your calibration or signal walls. What it can save, each with a backup first and an undo: Line up plans moves a plan's picture; Rooms from plans saves rooms. Turning it off hides it; it does not undo what you kept. Let Claude draw your rooms doesn't need it.")),
  ]));
  feats.appendChild(master);
  const under = el("div",{"data-ai-plans-under":"",style:`margin-left:22px;display:${settings.ai_plans_enabled === true ? "" : "none"}`});
  masterCb.addEventListener("change", ()=>{ const want = masterCb.checked; under.style.display = want ? "" : "none";
    save("ai_plans_enabled", want, ()=>{ masterCb.checked = !want; under.style.display = !want ? "" : "none"; }).then(ok=>{ if (ok && want && pbRefresh) pbRefresh(); }); });
  under.appendChild(sw("ai_stairs_enabled", t("Stairs from your floor plans"),
    t("Adds Read stairs off the plans (AI) to Live Aboard's Furnish → Build ▾ → House. Your AI looks for the stairs on each floor plan you placed and puts what it finds in as a first guess: check where each one stands and which way is up, then drag, turn or delete it. A small AI on your own computer finds most staircases but often gets their shape and which way is up wrong; a cloud AI reads plans better. The plans are sent to your AI only when you press it. Off until you turn it on."),
    settings.ai_stairs_enabled === true, false));
  under.appendChild(el("div",{style:"padding:8px 0;border-top:1px solid #1e3a2a"},[
    el("div",{style:"font-size:13px;color:#e2e8f0;font-weight:600"}, t("Add data via plans")),
    el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-top:2px"},
      t("In Live Aboard's Edit bar, the Plans tool: your AI reads the floor plans you placed for staircases and railings and lists what it finds for you to check, item by item. What you keep goes into your 3D house when you press Save, and one undo takes a whole session back.")),
  ]));
  // Build from plans (experimental; replaces "Rooms and walls… coming soon"): drawn only when the server says
  // Claude Opus 5.5 or newer is the AI Task (padspan_ha/plan_build_info); the panel never decides that itself.
  let helperRow = null;
  if (ctx.hass && ctx.hass.user && ctx.hass.user.is_admin) { const pb = _planBuildRow(ctx, el, save, settings); under.appendChild(pb); pbRefresh = pb._refresh; helperRow = pb._helper; }
  // The last session's undo (admins; ws_plan_ai.plan_ai_undo): what changed since is left, and said. Asked here in the page.
  if (ctx.hass && ctx.hass.user && ctx.hass.user.is_admin && settings.ai_plans_enabled === true) under.appendChild(_planAiLastRow(ctx, el));
  feats.appendChild(under);
  // Let Claude draw your rooms under its own name, outside the research switch it doesn't need (owner, 2026-11-12):
  // shown only once it has saved rooms that can be taken back.
  if (helperRow) feats.appendChild(helperRow);
  feats.appendChild(sw("ai_photos_enabled", t("Furniture from a photo"),
    t("In Live Aboard's Furnish, take a photo of a sofa, a bed or a lamp and the AI fills in its kind, style, colours and sizes. Tags, receivers and people's figures too. It names the piece itself, then reads that kind's details; telling it what the piece is first is quicker. It asks you for one real measurement unless something in the photo shows the scale."),
    settings.ai_photos_enabled !== false, false));
  feats.appendChild(sw("", t("Ask your voice assistant where someone is"),
    t("Lets an AI voice assistant in Home Assistant ask PadSpan which room someone is in, in your own words."), false, true));
  feats.appendChild(note);
  wrap.appendChild(feats);
  return wrap;
}
// i18n part: -

// i18n part: atlas
function _atlas3dSection(ctx, el, settings){
  const box = el("div",{"data-focus-part":"la3d",style:"margin-top:14px;padding-top:12px;border-top:1px solid #1e3a2a"});
  box.appendChild(el("div",{style:"font-weight:600;font-size:14px;color:#e2e8f0;margin-bottom:4px"},"🏠 Live Aboard"));
  // Experimental for now (2026-10-05: label it so in the stable release).
  box.appendChild(el("div",{"data-la3d-experimental":"",style:"display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;color:#fbbf24;border:1px solid rgba(251,191,36,.45);border-radius:999px;padding:1px 8px;margin:0 0 6px"},
    t("EXPERIMENTAL — still changing; tell us what you find")));
  box.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-bottom:8px"},
    t("Adds a Map / Live Aboard switch to the Atlas: turn, pan and zoom around your floors, rooms, walls, lights and furniture, built from the map you already drew. Off by default.")));
  // The setup wizard (views/aboard_wizard.js): every step from scratch,
  // with the optional extras below exposed along the way.
  const wizBtn = el("button",{class:"btn inline",style:"margin:0 0 8px;background:#1b4332;border-color:#52b788;color:#d8f3dc;font-weight:700"},t("✨ Set it up step by step"));
  wizBtn.addEventListener("click", ()=>{
    import(`./aboard_wizard.js${new URL(import.meta.url).search}`)
      .then(m => m.openLiveAboardWizard(ctx))
      .catch(e => ctx.toast(t("Could not open the wizard: {why}", { why: ctx.helpers.errorText(e) }), true));
  });
  box.appendChild(wizBtn);
  const note = el("div",{style:"font-size:11px;color:#94a3b8;margin:6px 0 0"}, t("Saves as soon as you change it. No restart needed."));
  const save = async (key, value, undo) => {
    try {
      const r = await ctx.actions.wsCall("padspan_ha/settings_set", { [key]: value });
      if (r && r.settings && ctx.state) ctx.state.settings = r.settings;
      note.textContent = t("Saved — the Atlas shows it at its next refresh.");
      return true;
    } catch (e) {
      if (undo) undo();
      ctx.toast(t("Could not save: {why}", { why: ctx.helpers.errorText(e) }), true);
      return false;
    }
  };

  const onRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer"});
  const onCb = el("input",{type:"checkbox"});
  onCb.checked = settings.atlas_3d_enabled === true;
  onRow.appendChild(onCb);
  onRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, t("Show Live Aboard on the Atlas")));
  box.appendChild(onRow);
  // What shows once the switch is on.
  const more = el("div",{"data-la3d-more":""});
  more.style.display = onCb.checked ? "block" : "none";
  const row = (label, kids) => el("div",{style:"display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:8px"},[
    el("span",{style:"color:#cbd5e1;font-size:13px;min-width:130px"}, label), ...kids,
  ]);

  // Quality.
  const cur = ["auto", "low", "high"].includes(settings.atlas_3d_quality) ? settings.atlas_3d_quality : "auto";
  const sel = document.createElement("select");
  sel.className = "select";
  sel.style.width = "auto";
  sel.style.maxWidth = "100%";
  for (const [v, label] of _ATLAS_3D_QUALITY) sel.appendChild(el("option",{value:v}, label()));
  sel.value = cur;
  let last = cur;
  sel.addEventListener("change", ()=>{ const want = sel.value; save("atlas_3d_quality", want, ()=>{ sel.value = last; }).then(ok=>{ if (ok) last = want; }); });
  more.appendChild(row(t("Quality"), [sel]));

  // Look: the same as the Atlas unless Live Aboard's own or Studio is chosen.
  const lookCur = settings.atlas_3d_look === "own" || settings.atlas_3d_look === "studio" ? settings.atlas_3d_look : "atlas";
  const lookSel = document.createElement("select");
  lookSel.className = "select";
  lookSel.style.width = "auto";
  lookSel.style.maxWidth = "100%";
  lookSel.setAttribute("data-la3d-key", "atlas_3d_look");
  for (const [v, label] of _ATLAS_3D_LOOK) lookSel.appendChild(el("option",{value:v}, label()));
  lookSel.value = lookCur;
  let lookLast = lookCur;
  lookSel.addEventListener("change", ()=>{ const want = lookSel.value; save("atlas_3d_look", want, ()=>{ lookSel.value = lookLast; }).then(ok=>{ if (ok) lookLast = want; }); });
  more.appendChild(row(t("Look"), [lookSel]));

  // The wall panel (live_aboard_panel.js): the sidebar's Live Aboard goes
  // back to its home view after this long untouched.
  const idleCur = [0, 30, 60, 300].includes(Number(settings.atlas_3d_home_idle_s)) ? Number(settings.atlas_3d_home_idle_s) : 60;
  const idleSel = document.createElement("select");
  idleSel.className = "select";
  idleSel.style.width = "auto";
  idleSel.style.maxWidth = "100%";
  idleSel.setAttribute("data-la3d-key", "atlas_3d_home_idle_s");
  for (const [v, label] of _ATLAS_3D_IDLE) idleSel.appendChild(el("option",{value:String(v)}, label()));
  idleSel.value = String(idleCur);
  let idleLast = idleCur;
  idleSel.addEventListener("change", ()=>{ const want = Number(idleSel.value); save("atlas_3d_home_idle_s", want, ()=>{ idleSel.value = String(idleLast); }).then(ok=>{ if (ok) idleLast = want; }); });
  more.appendChild(row(t("Back to home view"), [idleSel]));
  more.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin:4px 0 0 140px;line-height:1.5"},
    t("On the sidebar, Live Aboard flies back to its home view when nobody has touched it for this long. Set the home view in Views ▾ → Set as home. It waits while Edit or Furnish is open, a card is open, or you made it full screen.")));

  // The frame-rate readout (live_aboard_fps.js): this browser only, kept
  // where Live Aboard keeps its own per-screen choices (lights_map.js
  // _laPrefs, localStorage padspan_la3d_*). Off by default.
  const fpsRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px"});
  const fpsCb = el("input",{type:"checkbox","data-la3d-fps-pref":""});
  try { fpsCb.checked = localStorage.getItem("padspan_la3d_fps") === "1"; } catch (_) { fpsCb.checked = false; }
  fpsCb.addEventListener("change", ()=>{
    try { localStorage.setItem("padspan_la3d_fps", fpsCb.checked ? "1" : "0"); } catch (_) {}
    note.textContent = t("Saved for this browser — Live Aboard shows it at its next refresh.");
  });
  fpsRow.appendChild(fpsCb);
  fpsRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:13px"}, t("Show the frame rate (this browser only)")));
  more.appendChild(fpsRow);
  more.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin:4px 0 0 26px;line-height:1.5"},
    t("A small readout in the corner of Live Aboard: how many times a second the house is drawn, and \"0 fps at rest\" when nothing is moving. A wall screen shows it only if it is turned on there.")));

  // The director (live_aboard_director.js): what the sidebar's Live Aboard
  // flies to when it goes off, each with a camera's snapshot or none. An
  // administrator's (ws_settings holds the same rule).
  more.appendChild(_atlas3dDirector(ctx, el, settings, save, row));

  // The AI Task that reads photos lives in Settings → AI (with its switches).
  more.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-top:8px"},
    t("Furniture from a photo, and the AI Task that reads it, are in Settings → AI.")));

  // North: the GPS Bridge's own bearing (settings.fabric_bearing_deg), kept
  // to 0–359 the same way; a blank is refused rather than saved as 0, since
  // the GPS Bridge reads it too. What it means is shown, not stated: your
  // plan's outline as the Atlas draws it, with an N arrow where the bearing
  // puts north. The arrow's angle comes from fabric_compass.js, the one place
  // the bearing becomes a direction, loaded only once the 3D house is on.
  const norm = (v) => { const n = parseFloat(v); return isFinite(n) ? ((n % 360) + 360) % 360 : null; };
  let bearing = norm(settings.fabric_bearing_deg) ?? 0;
  const nInp = el("input",{type:"number", step:"1", min:"0", max:"359", value:String(bearing),
    style:"width:84px;padding:6px 8px;border-radius:8px;border:1px solid #2d4a37;background:#0a150e;color:#e2e8f0"});
  nInp.value = String(bearing);
  const NS = "http://www.w3.org/2000/svg", W = 132, H = 88, PAD = 7;
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const plan = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: String(W), height: String(H), "aria-hidden": "true" });
  plan.appendChild(svgEl("rect", { x: "0.5", y: "0.5", width: String(W - 1), height: String(H - 1), rx: "8", fill: "#0a150e", stroke: "#2d4a37" }));
  // Every indoor room, x right and y down — the plan as drawn.
  const rooms = Object.values((ctx.state.model && ctx.state.model.room_geometry_m) || {})
    .filter(g => g && Array.isArray(g.points_m) && g.points_m.length >= 3 && !/^(__outside__|outside|outdoors?|garden|yard)$/i.test(String(g.floor_id || "")))
    .map(g => g.points_m.map(q => [Number(q[0]), Number(q[1])]).filter(q => isFinite(q[0]) && isFinite(q[1])))
    .filter(r => r.length >= 3);
  const xs = rooms.flat().map(q => q[0]), ys = rooms.flat().map(q => q[1]);
  if (xs.length) {
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 || 1, h = Math.max(...ys) - y0 || 1;
    const k = Math.min((W - 2 * PAD) / w, (H - 2 * PAD) / h), ox = (W - w * k) / 2, oy = (H - h * k) / 2;
    const g = svgEl("g", { fill: "rgba(82,183,136,.10)", stroke: "rgba(167,243,208,.55)", "stroke-width": "0.8", "stroke-linejoin": "round" });
    for (const r of rooms) g.appendChild(svgEl("polygon", { points: r.map(q => `${(ox + (q[0] - x0) * k).toFixed(1)},${(oy + (q[1] - y0) * k).toFixed(1)}`).join(" ") }));
    plan.appendChild(g);
  } else {
    plan.appendChild(svgEl("rect", { x: String(PAD + 14), y: String(PAD + 8), width: String(W - 2 * PAD - 28), height: String(H - 2 * PAD - 16),
      fill: "rgba(82,183,136,.10)", stroke: "rgba(167,243,208,.55)", "stroke-width": "0.8" }));
  }
  const cx = W / 2, cy = H / 2;
  const needle = svgEl("g", { "data-la3d-north": "", visibility: "hidden" });
  needle.appendChild(svgEl("circle", { cx: String(cx), cy: String(cy), r: "3", fill: "#ef5350" }));
  needle.appendChild(svgEl("path", { d: `M${cx},${cy - 30} L${cx + 6},${cy - 17} L${cx - 6},${cy - 17} Z`, fill: "#ef5350" }));
  needle.appendChild(svgEl("line", { x1: String(cx), y1: String(cy), x2: String(cx), y2: String(cy - 18), stroke: "#ef5350", "stroke-width": "2" }));
  plan.appendChild(needle);
  // The N stays upright at the arrow's tip.
  const nLabel = svgEl("text", { x: String(cx), y: String(cy - 33), "text-anchor": "middle", "dominant-baseline": "central",
    "font-size": "10", "font-weight": "700", fill: "#f3f6f4", "font-family": "system-ui,sans-serif", visibility: "hidden" });
  nLabel.textContent = "N";
  plan.appendChild(nLabel);
  const preview = el("span",{title:t("North on your plan"), style:`display:inline-flex;width:${W}px;height:${H}px`}, [plan]);
  let arrowDeg = null, compassP = null;
  const turn = (b) => {
    if (!arrowDeg || b === null) return;
    const a = arrowDeg(b);
    needle.setAttribute("transform", `rotate(${a.toFixed(1)} ${cx} ${cy})`);
    nLabel.setAttribute("x", (cx + 36 * Math.sin(a * Math.PI / 180)).toFixed(1));
    nLabel.setAttribute("y", (cy - 36 * Math.cos(a * Math.PI / 180)).toFixed(1));
    needle.setAttribute("visibility", "visible");
    nLabel.setAttribute("visibility", "visible");
  };
  const loadCompass = () => (compassP = compassP || import(`./fabric_compass.js${new URL(import.meta.url).search}`)
    .then(m => { arrowDeg = m.northArrowDeg; turn(bearing); })
    .catch(err => { console.warn("PadSpan: fabric_compass failed to load", err); }));
  nInp.addEventListener("input", ()=> turn(norm(nInp.value)));
  nInp.addEventListener("change", ()=>{
    const b = norm(nInp.value), was = bearing;
    if (b === null) { nInp.value = String(was); turn(was); ctx.toast(t("Enter a bearing from 0 to 359"), true); return; }
    nInp.value = String(b); turn(b); bearing = b;
    save("fabric_bearing_deg", b, ()=>{ bearing = was; nInp.value = String(was); turn(was); });
  });
  more.appendChild(row(t("North"), [nInp, el("span",{style:"color:#94a3b8;font-size:12px"},"°"), preview]));
  more.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin:4px 0 0 140px;line-height:1.5"},
    t("The same bearing the GPS Bridge uses. The arrow shows where it puts north on your plan.")));
  // Rain and snow, people, tags: each its own switch, saved alone.
  // Show people and Show tags & scanners are switched in ONE place
  // (2026-10-30): Live Aboard's Views ▾ while Live Aboard is on, where they
  // are seen; here, with the state and a way there. With Live Aboard off
  // that menu doesn't exist, and both still draw on the flat map, so the
  // switch is here then (the only place it can be reached).
  const _LA_SWITCHED = { atlas_3d_people: "Show people", atlas_3d_tags: "Show tags & scanners" };
  const laOn = settings.atlas_3d_enabled === true;
  const tick = (key, label, checked, hint, into = more) => {
    if (laOn && _LA_SWITCHED[key]) {
      const go = el("button",{class:"btn inline","data-goto":"live-aboard-views"},t("Open Live Aboard"));
      go.addEventListener("click", ()=>{
        try { localStorage.setItem("padspan_lv_3d_builder", "1"); } catch (_) { /* private mode */ }
        ctx.state.view = "maps";
        if (ctx.actions.renderNav) ctx.actions.renderNav();
        if (ctx.actions.setMapsTab) ctx.actions.setMapsTab("lights"); else { ctx.state.mapsTab = "lights"; ctx.actions.renderRooms(); }
      });
      into.appendChild(el("div",{"data-la3d-state":key,style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px"},[
        el("span",{style:"color:#e2e8f0;font-size:13px"}, `${label}: ${checked ? "On" : "Off"}`),
        el("span",{style:"color:#94a3b8;font-size:12px"}, t("Switch it in Live Aboard: Views ▾ → {name}.", { name: _LA_SWITCHED[key] })),
        // Mapping → Atlas builder is an expert screen: not from Basic.
        FOCUS.expertLinks(ctx.state) ? go : null,
      ]));
      into.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin:2px 0 0 0;line-height:1.5"}, hint));
      return;
    }
    const r = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:10px"});
    const cb = el("input",{type:"checkbox"});
    cb.checked = checked;
    cb.setAttribute("data-la3d-key", key);
    cb.addEventListener("change", ()=>{ const want = cb.checked; save(key, want, ()=>{ cb.checked = !want; }); });
    r.appendChild(cb);
    r.appendChild(el("span",{style:"color:#e2e8f0;font-size:13px"}, label));
    into.appendChild(r);
    into.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin:2px 0 0 26px;line-height:1.5"}, hint));
  };
  // People and tags show on the Atlas's flat map too, with Live Aboard on or
  // off: their two switches stand outside the Live Aboard rows, always shown.
  const both = el("div",{"data-la3d-both":"", style:"margin-top:12px;padding-top:8px;border-top:1px dashed #1e3a2a"});
  both.appendChild(el("div",{style:"font-size:12px;color:#cbd5e1;font-weight:600"}, t("On the Atlas's map and in Live Aboard")));
  tick("atlas_3d_weather", t("Rain and snow"), settings.atlas_3d_weather !== false,
    t("Follows Outdoor weather above, and shows only while that is on too."));
  tick("atlas_3d_people", t("Show people"), settings.atlas_3d_people === true,
    t("Each person where their phone or tag is now: on the map, a round marker with their initial; in Live Aboard, their figure (or a soft marker), walking there. Tap one for where they are and since when. Uses the same live positions as Overview."), both);
  // Who shows in the house is an administrator's (ws_settings holds the same
  // rule; Live Aboard's Views menu shows these on or off to anyone else).
  const whoShows = !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
  tick("atlas_3d_tags", t("Show tags & scanners"), settings.atlas_3d_tags === true,
    t("Every tag the Atlas can place, with its name, and every scanner (in Live Aboard, every scanner at its height). The faint ring under a tag is wider the less sure its spot is. Tap a tag for its room, when it was last seen and which scanners hear it. Uses the same live positions as Overview."), both);
  if (!whoShows) {
    for (const cb of both.querySelectorAll("input[data-la3d-key]")) {
      if (cb.getAttribute("data-la3d-key") === "atlas_3d_people" || cb.getAttribute("data-la3d-key") === "atlas_3d_tags") {
        cb.disabled = true; cb.title = t("Only an administrator can change this");
      }
    }
  }
  // Remove all furniture (admins; ws_house3d.house3d_clear only="pieces"): the
  // server takes a backup first and removes nothing without one. Asked here
  // in the page, the way Clear calibration asks above.
  if (ctx.hass && ctx.hass.user && ctx.hass.user.is_admin) {
    const rmWrap = el("span",{"data-la3d-rmfur":"", style:"display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center"});
    const rmBtn = () => {
      rmWrap.innerHTML = "";
      rmWrap.appendChild(el("button",{class:"btn inline", style:"color:#f87171;border-color:#f8717140", onclick: ()=>{
        rmWrap.innerHTML = "";
        rmWrap.appendChild(el("span",{style:"font-size:12px;color:#fca5a5"}, t("Remove every piece of furniture? A backup is taken first.")));
        rmWrap.appendChild(el("button",{class:"btn inline", style:"background:#7f1d1d;border-color:#dc2626;color:#fca5a5", onclick: async ()=>{
          rmWrap.innerHTML = "";
          rmWrap.appendChild(el("span",{style:"font-size:12px;color:#94a3b8"}, t("Removing…")));
          try {
            const r = await ctx.actions.wsCall("padspan_ha/house3d_clear", { only: "pieces" });
            ctx.toast(r && r.backup_id ? t("All furniture removed. To bring it back, restore the backup taken just now (Backup & Restore).")
              : t("There was no furniture to remove."));
            // Every Live Aboard open in this page reads its file again.
            try { window.dispatchEvent(new Event("padspan-ha-house3d-changed")); } catch (_) { /* none open */ }
          } catch (e) {
            ctx.toast(t("Could not remove the furniture: {why}", { why: ctx.helpers.errorText(e) }), true);
          }
          rmBtn();
        }}, t("Remove all")));
        rmWrap.appendChild(el("button",{class:"btn inline", style:"color:#94a3b8;border-color:#94a3b840", onclick: rmBtn}, t("Cancel")));
      }}, t("Remove all furniture…")));
    };
    rmBtn();
    more.appendChild(row(t("Furniture"), [rmWrap]));
  }
  if (onCb.checked) loadCompass();
  // The shared library's rows, built once the switch is on (below).
  let libraryRows = false;
  const addLibraryRows = () => { if (!libraryRows) { libraryRows = true; _atlas3dLibraryRows(ctx, el, settings, more, row, save); } };
  if (onCb.checked) addLibraryRows();
  box.appendChild(more);
  box.appendChild(both);
  onCb.addEventListener("change", ()=>{
    const want = onCb.checked;
    more.style.display = want ? "block" : "none";
    if (want) { loadCompass(); addLibraryRows(); }
    save("atlas_3d_enabled", want, ()=>{ onCb.checked = !want; more.style.display = !want ? "block" : "none"; });
  });
  box.appendChild(note);
  return box;
}

// Live Aboard's shared furniture library (views/live_aboard_library.js,
// ws_house3d_library.py): its switch, which only an administrator can change
// (ws_settings: the library lets data leave the house), and "Withdraw my
// shared furniture", which takes every piece this house shared out of the
// library (admin) after an ask in the page. Built only once the 3D house is
// on, so the box says nothing of them while it is off, and only once the
// library's server is live (LIBRARY_SERVER_LIVE in the library's own module,
// loaded here only then): before that, nothing of the library shows.
/** "Last plan session: 17 items, 2026-11-05 · Undo": hidden until the server names a batch that can be undone. */
/** The AI credit tracker (ai_usage.py, experimental, 2026-11-09): this month's AI reads under
 *  the AI Task picker. For a Claude AI Task, the estimate, "of your monthly credit" once an amount is
 *  typed in, and the warning (off until chosen); any other AI, reads only. The stops by reason. */
// i18n part: ai
function _aiUsageRow(ctx, el, save){
  const settings = ctx.state.settings || {};
  const box = el("div",{"data-ai-usage":"",style:"display:none;margin-top:10px;padding:8px 10px;border:1px solid #1e3a2a;border-radius:8px"});
  const chip = el("span",{style:"margin-left:8px;font-size:10px;font-weight:700;letter-spacing:.06em;color:#fbbf24;border:1px solid rgba(251,191,36,.45);border-radius:999px;padding:0 7px"}, t("EXPERIMENTAL"));
  const line = el("div",{style:"font-size:13px;color:#e2e8f0;font-weight:600"});
  const stops = el("div",{"data-ai-usage-stops":"",style:"display:none;font-size:12px;color:#fca5a5;margin-top:4px"});
  const how = el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-top:4px"});
  const controls = el("div",{style:"display:none;flex-wrap:wrap;gap:10px;align-items:center;margin-top:8px"});
  const money = (v) => `$${Number(v).toFixed(2)}`;
  let credit = Number(settings.ai_credit_month_usd) > 0 ? Number(settings.ai_credit_month_usd) : 0;
  const inp = el("input",{type:"number", min:"0", step:"any", placeholder:t("e.g. 200"), "data-ai-credit":"", class:"input", style:"width:90px;box-sizing:content-box"});
  inp.value = credit > 0 ? String(credit) : "";
  inp.addEventListener("change", ()=>{ const was = credit, want = inp.value.trim() === "" ? 0 : Math.max(0, Number(inp.value) || 0);
    save("ai_credit_month_usd", want, ()=>{ inp.value = was > 0 ? String(was) : ""; }).then(ok=>{ if (ok) { credit = want; load(); } }); });
  const warn = document.createElement("select");
  warn.className = "select";
  warn.setAttribute("data-ai-credit-warn", "");
  for (const [v, n] of [["0", t("Off")], ["50", t("at 50 %")], ["75", t("at 75 %")], ["90", t("at 90 %")]]) warn.appendChild(el("option",{value:v}, n));
  warn.value = String([50, 75, 90].includes(Number(settings.ai_credit_warn_pct)) ? Number(settings.ai_credit_warn_pct) : 0);
  let warnLast = warn.value;
  warn.addEventListener("change", ()=>{ const want = warn.value; save("ai_credit_warn_pct", Number(want), ()=>{ warn.value = warnLast; }).then(ok=>{ if (ok) warnLast = want; }); });
  controls.appendChild(el("label",{style:"display:flex;align-items:center;gap:6px;font-size:12px;color:#a7f3d0;white-space:nowrap"}, [t("Your monthly credit, US$"), inp]));
  controls.appendChild(el("label",{style:"display:flex;align-items:center;gap:6px;font-size:12px;color:#a7f3d0;white-space:nowrap"}, [t("Warn me"), warn]));
  box.appendChild(line);
  box.appendChild(stops);
  box.appendChild(how);
  box.appendChild(controls);
  function show(u){
    box.style.display = u ? "" : "none";
    if (!u) return;
    const claude = u.main_maker === "claude";
    let text;
    if (claude) {
      text = t("Claude reads this month: {count}", { count: u.claude_reads });
      // A priced model with nothing priced yet this month (the 1st, or only failed reads) is $0.00, not "no price known".
      if (u.claude_usd == null && !u.main_priced) text += " " + t("(no price known for this model)");
      else text += ", " + (credit > 0 ? t("about {cost} of your ${credit} monthly credit", { cost: money(u.claude_usd || 0), credit })
        : t("about {cost}", { cost: money(u.claude_usd || 0) }));
    } else {
      text = t("AI reads this month: {count}", { count: u.reads });
    }
    line.innerHTML = "";
    line.appendChild(document.createTextNode(text));
    line.appendChild(chip);
    const list = u.stops || [];
    const n = list.reduce((s, x) => s + (x.n || 0), 0);
    stops.style.display = n ? "" : "none";
    stops.textContent = !n ? "" : tn(n, "{n} read stopped: {what}", "{n} reads stopped: {what}",
      { what: list.length === 1 ? list[0].words : list.map(x => `${x.n} ${x.words}`).join(", ") });
    how.innerHTML = "";
    if (claude) {
      how.appendChild(document.createTextNode(t("An estimate from each picture's size and each question's length: Home Assistant doesn't pass on what Claude counted. Exact numbers: ")));
      how.appendChild(el("a",{href:"https://platform.claude.com/usage", target:"_blank", rel:"noopener noreferrer", style:"color:#52b788"}, "Anthropic Console → Usage"));
      how.appendChild(document.createTextNode(" " + t("(filter by the key Home Assistant uses).") + (u.warned ? " " + t("This month's warning has been shown.") : "")));
    } else {
      how.textContent = t("Every read PadSpan sent to your AI this month. A cost is estimated for Claude only.");
    }
    controls.style.display = claude ? "flex" : "none";
  }
  // Sample mode's {}: nothing. No AI Task and no reads this month: nothing either (a house that never uses AI, review B4).
  function load(){ ctx.actions.wsCall("padspan_ha/ai_usage_get").then(u => show(u && u.month && (u.main_maker || u.reads) ? u : null)).catch(() => show(null)); }
  load();
  return box;
}

/** Settings → AI: Build from plans: advanced plan alignment (Claude, experimental). Off for everyone; drawn
 *  only when the server's unlock rule passes (plan_ai.unlock: Claude Opus 5.5 or newer through Home Assistant's
 *  Anthropic integration) and the master switch is on; asked again after the AI Task changes (`_refresh`). */
function _planBuildRow(ctx, el, save, settings){
  const box = el("div",{"data-ai-plan-build":"", style:"display:none;padding:8px 0;border-top:1px solid #1e3a2a"});
  // Let Claude draw your rooms' own row (its later undo), placed by the caller outside the research switch.
  const hbox = el("div",{"data-ai-helper":"", style:"display:none;padding:8px 0;border-top:1px solid #1e3a2a"});
  box._helper = hbox;
  let on = settings.ai_plan_build_enabled === true;
  const chip = () => el("span",{style:"margin-left:8px;font-size:10px;font-weight:700;letter-spacing:.06em;color:#fbbf24;border:1px solid rgba(251,191,36,.45);border-radius:999px;padding:0 7px"}, t("EXPERIMENTAL"));
  const show = (info) => {
    box.innerHTML = "";
    hbox.innerHTML = "";
    const ok = !!(info && info.master && info.unlock && info.unlock.ok);
    // The last line-up's undo stays here whatever the AI Task (form q3): a session can always be taken back.
    const undo = info && info.master && info.undo ? info.undo : null;
    const ru = info && info.rooms_undo ? info.rooms_undo : null;
    const rundo = ru && !ru.helper && info.master ? ru : null;    // Rooms from plans' (Stage 2), under the research switch
    const hundo = ru && ru.helper ? ru : null;                     // the helper's, under its own name, whatever the switches
    hbox.style.display = hundo ? "" : "none";
    if (hundo) {
      hbox.appendChild(el("div",{style:"font-size:13px;color:#e2e8f0;font-weight:600"}, ["Let Claude draw your rooms", chip()]));
      hbox.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin:2px 0 6px"},
        t("Claude reads a floor plan and draws its rooms for you to check; it is offered in Setup's Draw the rooms step. It needs none of the switches above.")));
      hbox.appendChild(undoRow(hundo, true, true));
    }
    // AI map-building research on and Claude not usable: why the row isn't here, in the rooms helper's words (one copy:
    // ai_wizard_offer.js), and the guide. Nothing while the research switch is off.
    const cs = info && info.master && info.unlock && !info.unlock.ok && AIWO ? AIWO.claudeState(info) : null;
    const why = cs ? AIWO.claudeWhyWords(cs) : "";
    box.style.display = ok || undo || rundo || why ? "" : "none";
    if (!ok) {
      if (why) {
        const line = el("div",{"data-ai-plan-build-why":"", style:"font-size:11px;color:#94a3b8;line-height:1.5;margin:0 0 6px 0"},
          t("Build from plans (experimental) isn't offered here.") + " " + why + " " + (cs.why === "available_unchosen" ? t("Choose it as your AI Task above.")
            : t("It needs {model} through Home Assistant's Anthropic integration.", { model: AIWO.MODEL_WORDS })) + " ");
        if (newTabOk(ctx.state.kioskMode)) line.appendChild(el("a",{href:AIWO.GUIDE_URL, target:"_blank", rel:"noopener", style:"color:#8ee5b4"}, t("How to connect Claude ↗")));
        box.appendChild(line);
      }
      if (undo) box.appendChild(undoRow(undo, false)); if (rundo) box.appendChild(undoRow(rundo, false, true)); return;
    }
    const label = el("label",{style:"display:flex;align-items:flex-start;gap:10px;cursor:pointer"});
    const cb = el("input",{type:"checkbox", style:"margin-top:3px", "data-ai-plan-build-switch":""});
    cb.checked = on;
    cb.addEventListener("change", ()=>{ const want = cb.checked; save("ai_plan_build_enabled", want, ()=>{ cb.checked = !want; }).then(ok2=>{ if (ok2) on = want; }); });
    label.appendChild(cb);
    label.appendChild(el("div",{},[
      el("div",{style:"font-size:13px;color:#e2e8f0;font-weight:600"}, [t("Build from plans: advanced plan alignment (Claude, experimental)"), chip()]),
      el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-top:2px"},
        t("Claude reads your floor plans and lines them up to each other and to your house. You check every change on a map before anything is saved; a backup is taken before each save and one undo takes a session back. Lining plans up never changes calibration or anything placed in metres. Needs Claude Opus 5.5 or newer as your AI Task. In Live Aboard: Edit → Plans → Line up plans; then, on a lined-up floor, Rooms from plans reads its rooms, doors, windows and stairs, saved together with one backup and one undo.")),
      el("div",{style:"font-size:11px;color:#a7f3d0;margin-top:2px"}, t("Reads with {model}. The plans leave the house for Anthropic.", { model: info.unlock.display || "Claude" })),
    ]));
    box.appendChild(label);
    // The stall watch (design 14): this house's own stops, said here, not only in the usage report.
    const month = (info.stall && info.stall.month) || {}, words = (info.stall && info.stall.words) || {};
    const keys = Object.keys(month).filter(k => month[k] > 0).sort((a, b) => month[b] - month[a]);
    if (keys.length) box.appendChild(el("div",{"data-ai-plan-build-stops":"", style:"font-size:11px;color:#94a3b8;line-height:1.5;margin:4px 0 0 24px"},
      t("Line-up stops this month (experimental): {list}", { list: keys.slice(0, 4).map(k => `${String(words[k] || k).replace(/\.$/, "")} (×${month[k]})`).join(" · ") })));
    if (undo) { const r = undoRow(undo, true); r.style.margin = "6px 0 0 24px"; box.appendChild(r); }
    if (rundo) { const r = undoRow(rundo, true, true); r.style.margin = "6px 0 0 24px"; box.appendChild(r); }
  };
  // Undo this line-up session (experimental): asked once, then the whole session; said in plain words either way.
  // `rooms`: the same for Rooms from plans (Stage 2): its own words, session and command (UNDO_OF).
  const UNDO_OF = {
    lineup: { title: t("Undo this line-up session (experimental)"), cmd: "padspan_ha/plan_build_undo", prefix: t("{tool} (experimental): ", { tool: "Line up plans" }), tool: "Line up plans",
      what: (u) => tn(u.items, "The last plan line-up saved on {floor}{when}: {n} plan moved or refiled.", "The last plan line-up saved on {floor}{when}: {n} plans moved or refiled.",
        { floor: u.floor_name || t("a floor"), when: u.when }) + " " +
        t("Undo puts every one back where it was; a backup is taken first, and a plan you moved by hand since is left as it is."),
      sure: t("Put every plan this session saved back where it was?"),
      done: (n, k) => tn(n, "{n} plan put back where it was", "{n} plans put back where they were") +
        (k ? "; " + tn(k, "{n} moved by hand since left as it is", "{n} moved by hand since left as they are") : "") + "." },
    rooms: { title: t("Undo this rooms session (experimental)"), cmd: "padspan_ha/plan_build_rooms_undo", prefix: t("{tool} (experimental): ", { tool: "Rooms from plans" }), tool: "Rooms from plans",
      what: (u) => tn(u.items, "The last rooms from plans saved on {floor}{when}: {n} item (rooms, doors, windows, stairs).",
        "The last rooms from plans saved on {floor}{when}: {n} items (rooms, doors, windows, stairs).", { floor: u.floor_name || t("a floor"), when: u.when }) + " " +
        t("Undo puts every one back as it was; a backup is taken first, and anything you changed since is left as it is."),
      sure: t("Put every room, door, window and stair this session saved back as it was?"),
      done: (n, k) => t("{n} put back", { n }) + (k ? "; " + tn(k, "{n} changed since left as it is", "{n} changed since left as they are") : "") + "." },
    // The same undo for rooms the rooms helper saved (plan_ai.rooms_undo_info's `helper`), said in the helper's name, sent as
    // the helper's (via "wizard": it isn't offered on the Overview again, and is counted). Then, as the Done screen's Undo, the
    // plan's scale the helper set, when the server says it goes (u.scale, by scale_undo's own rule; owner, 2026-11-11: warned
    // first; a scale measured again by hand is the person's and is neither warned about nor removed).
    // Its words and its run are the helper's own (views/ai_wizard_offer.js: one copy for the Done screen, Setup and here).
    helper: { title: AIWO ? AIWO.UNDO_TITLE : "", cmd: "padspan_ha/plan_build_rooms_undo", via: "wizard", prefix: t("{tool} (experimental): ", { tool: "Let Claude draw your rooms" }),
      tool: "Let Claude draw your rooms", what: (u) => (AIWO ? AIWO.undoWhat(u) : ""), sure: (u) => (AIWO ? AIWO.undoSure(u) : "") },
  };
  const asking = { lineup: false, rooms: false, helper: false }, said = { lineup: "", rooms: "", helper: "" };
  function undoRow(u, unlocked, rooms = false){
    const kind = rooms ? (u.helper ? "helper" : "rooms") : "lineup", K = UNDO_OF[kind];
    const row = el("div",{[rooms ? "data-ai-plan-build-rooms-undo" : "data-ai-plan-build-undo"]:"", style:"font-size:11px;color:#94a3b8;line-height:1.5;margin:0 0 6px 0"});
    const when = u.at ? ` (${new Date(u.at * 1000).toLocaleDateString()})` : "";
    row.appendChild(el("div",{style:"font-size:12px;color:#e2e8f0;font-weight:600"}, [K.title, chip()]));
    row.appendChild(el("div",{}, K.what({ ...u, when }) + (unlocked ? "" : " " + t("{tool} is hidden while your AI Task isn't Claude Opus 5.5 or newer; this undo stays here.", { tool: K.tool }))));
    const bs = { style:"margin:4px 6px 0 0;padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e2e8f0;font-size:11px;cursor:pointer" };
    if (!asking[kind]) {
      const b = el("button",{...bs, type:"button", "data-ai-plan-build-undo-ask":""}, K.title);
      b.addEventListener("click", ()=>{ asking[kind] = true; said[kind] = ""; ask(); });
      row.appendChild(b);
    } else {
      const yes = el("button",{...bs, type:"button", "data-ai-plan-build-undo-go":"", style: bs.style + ";background:#1b4332;border-color:#52b788;color:#d8f3dc;font-weight:700"}, t("Undo it (experimental)"));
      const no = el("button",{...bs, type:"button"}, t("Cancel"));
      yes.addEventListener("click", ()=>{
        yes.disabled = true;
        // The helper's: its own run (the rooms, then the scale where it goes); the others: their one command.
        const run = kind === "helper" && AIWO ? AIWO.undoHelperRooms(ctx, u).then(out => (out.ok ? { text: AIWO.undoDone(out) } : out))
          : ctx.actions.wsCall(K.cmd, { session: u.session }).then(r => (r && r.ok === false ? { ok: false, message: String(r.message || r.code || "") }
            : { text: K.done((r && r.undone) || 0, ((r && r.skipped) || []).length) }));
        run.then((r)=>{
          asking[kind] = false;
          if (r && r.ok === false) { said[kind] = r.message; ask(); return; }
          if (kind === "helper" && typeof ctx.actions.telemetryEvent === "function") ctx.actions.telemetryEvent("ai_wizard:undo_from_settings");
          ctx.toast(K.prefix + r.text);
          said[kind] = ""; ask();
        }).catch((e)=>{ asking[kind] = false; said[kind] = K.prefix + String((e && e.message) || e).replace(K.prefix, ""); ask(); });
      });
      no.addEventListener("click", ()=>{ asking[kind] = false; ask(); });
      row.appendChild(el("div",{style:"color:#fde68a;margin-top:2px"}, typeof K.sure === "function" ? K.sure(u) : K.sure));
      row.appendChild(yes); row.appendChild(no);
    }
    if (said[kind]) row.appendChild(el("div",{role:"alert", style:"color:#fca5a5;margin-top:2px"}, said[kind]));
    return row;
  }
  const ask = () => ctx.actions.wsCall("padspan_ha/plan_build_info").then(show).catch(() => show(null));
  box._refresh = ask;
  ask();                                            // the helper's undo is asked for whatever the research switch (its own row)
  return box;
}
function _planAiLastRow(ctx, el){
  const box = el("div",{"data-ai-plans-last":"", style:"display:none;padding:8px 0;border-top:1px solid #1e3a2a"});
  const show = (u) => {
    box.innerHTML = "";
    box.style.display = u ? "" : "none";
    if (!u) return;
    const when = u.at ? new Date(u.at * 1000) : null;
    const day = when ? `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}` : "";
    const n = u.items || 0;
    const back = u.puts_back === true;
    box.appendChild(el("div",{style:"font-size:13px;color:#e2e8f0;font-weight:600"}, back ? tn(n, "The last undo: {n} item, {day}", "The last undo: {n} items, {day}", { day }) : tn(n, "Last plan session: {n} item kept, {day}", "Last plan session: {n} items kept, {day}", { day })));
    const acts = el("span",{style:"display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px"});
    const ask = () => {
      acts.innerHTML = "";
      acts.appendChild(el("button",{class:"btn inline", type:"button", "data-ai-plans-undo":"", onclick: ()=>{
        acts.innerHTML = "";
        acts.appendChild(el("span",{style:"font-size:12px;color:#fca5a5"}, back ? t("Put those items back in your 3D house?") : t("Take what this session kept out of your 3D house? Anything you changed since is left as it is.")));
        acts.appendChild(el("button",{class:"btn inline", type:"button", "data-ai-plans-undo-yes":"", style:"background:#7f1d1d;border-color:#dc2626;color:#fca5a5", onclick: async ()=>{
          acts.innerHTML = "";
          acts.appendChild(el("span",{style:"font-size:12px;color:#94a3b8"}, t("Working…")));
          try {
            const r = await ctx.actions.wsCall("padspan_ha/plan_ai_undo", { batch_id: u.id });
            const left = (r && r.skipped ? r.skipped.length : 0);
            ctx.toast((back ? t("Put back: {done} of {of}", { done: r.undone, of: r.of }) : t("Undone: {done} of {of}", { done: r.undone, of: r.of })) +
              (left ? ". " + tn(left, "{n} was changed since and left as it is", "{n} were changed since and left as they are") : "") + ".");
            // Every Live Aboard open in this page reads its file again.
            try { window.dispatchEvent(new Event("padspan-ha-house3d-changed")); } catch (_) { /* none open */ }
            show(r && r.undo);
          } catch (e) {
            ctx.toast(t("Could not undo: {why}", { why: ctx.helpers.errorText(e) }), true);
            ask();
          }
        }}, back ? t("Put back") : t("Undo")));
        acts.appendChild(el("button",{class:"btn inline", type:"button", style:"color:#94a3b8;border-color:#94a3b840", onclick: ask}, t("Cancel")));
      }}, back ? t("Put back…") : t("Undo this session…")));
    };
    ask();
    box.appendChild(el("div",{}, [acts]));
  };
  ctx.actions.wsCall("padspan_ha/plan_ai_sessions_get").then((r) => show(r && r.undo)).catch(() => show(null));
  return box;
}
// i18n part: atlas
function _atlas3dLibraryRows(ctx, el, settings, more, row, save){
  const spot = el("div",{});
  more.appendChild(spot);
  import(`./live_aboard_library.js${new URL(import.meta.url).search}`)
    .then(m => { if (m.LIBRARY_SERVER_LIVE !== false) _atlas3dLibraryRowsShown(ctx, el, settings, spot, row, save); })
    .catch(err => { console.warn("PadSpan: the furniture library failed to load", err); });
}
function _atlas3dLibraryRowsShown(ctx, el, settings, more, row, save){
  const cb = el("input",{type:"checkbox"});
  cb.checked = settings.atlas_3d_library === true;
  more.appendChild(row(t("Shared library"), [el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer"},
    [cb, el("span",{style:"color:#e2e8f0;font-size:13px"},t("Use the shared furniture library"))])]));
  more.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin:4px 0 0 140px;line-height:1.5"},
    t("Find furniture other PadSpan houses made, and share yours once you accept the library's terms. Only a piece's shape, sizes, colours and details are shared. Off: Live Aboard never contacts the library.")));
  const wd = el("button",{class:"btn", type:"button", "data-la3d-withdraw":""},t("Withdraw my shared furniture"));
  const yes = el("button",{class:"btn", type:"button", "data-la3d-withdraw-yes":""},t("Withdraw them"));
  const no = el("button",{class:"btn", type:"button"},t("Cancel"));
  const ask = el("div",{style:"margin-top:6px;padding:8px 10px;border-radius:8px;background:#1f1a0a;border:1px solid #5c4a14;color:#fde68a;font-size:12px;line-height:1.5"},[
    el("div",{},t("Take every piece this house shared out of the library? Copies already placed in other houses stay there.")),
    el("div",{style:"display:flex;gap:8px;margin-top:6px"},[yes, no])]);
  ask.style.display = "none";
  const wdRow = row("", [wd]);
  wdRow.appendChild(ask);
  wdRow.style.display = cb.checked ? "flex" : "none";
  more.appendChild(wdRow);
  cb.addEventListener("change", ()=>{
    const want = cb.checked;
    wdRow.style.display = want ? "flex" : "none";
    save("atlas_3d_library", want, ()=>{ cb.checked = !want; wdRow.style.display = !want ? "flex" : "none"; });
  });
  wd.addEventListener("click", ()=>{ ask.style.display = "block"; wd.disabled = true; });
  no.addEventListener("click", ()=>{ ask.style.display = "none"; wd.disabled = false; });
  yes.addEventListener("click", async ()=>{
    yes.disabled = true;
    try {
      const r = await ctx.actions.wsCall("padspan_ha/house3d_library_withdraw", {});
      const n = Number(r && r.withdrawn) || 0, left = Number(r && r.left) || 0;
      ctx.toast(tn(n, "{n} piece taken out of the library.", "{n} pieces taken out of the library.") +
        (left ? " " + t("{count} could not be reached yet: try again later.", { count: left }) : ""));
    } catch (e) {
      ctx.toast(t("Could not withdraw: {why}", { why: ctx.helpers.errorText(e) }), true);
    }
    yes.disabled = false;
    ask.style.display = "none";
    wd.disabled = false;
  });
}
// i18n part: -

// ── UI Structure tab ──────────────────────────────────────────────────────────
const _DEV_ONLY_TABS = ["devices","bluetooth","presence","monitor","qa","sandbox"];
const _TAB_LABELS = {devices: () => t("Devices"), bluetooth: () => t("Bluetooth"), presence: () => t("Presence"), monitor: () => t("Monitor"),
  qa: () => t("QA"), sandbox: () => t("Sandbox")};

function _settingsUI(ctx, el){
  const wrap = el("div",{});
  const settings = ctx.state.settings || {};
  const extras = settings.advanced_extra_tabs || [];

  wrap.appendChild(el("h3",{style:"color:#52b788;margin-bottom:8px"},t("UI Structure")));
  wrap.appendChild(el("p",{style:"color:#94a3b8;font-size:13px;margin-bottom:16px"},
    t("Every tab is in the menu in every mode; the ones not in the main list are under More tools. Tick a tab to list it in the main menu in Advanced and Development mode. Basic keeps its short list.")));

  const card = el("div",{class:"card",style:"padding:16px"});
  const checks = [];
  for(const tabId of _DEV_ONLY_TABS){
    const label = _TAB_LABELS[tabId] ? _TAB_LABELS[tabId]() : tabId;
    const checked = extras.includes(tabId);
    const row = el("label",{style:"display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer"});
    const cb = el("input",{type:"checkbox"});
    cb.checked = checked;
    cb.dataset.tab = tabId;
    checks.push(cb);
    row.appendChild(cb);
    row.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, label));
    card.appendChild(row);
  }
  wrap.appendChild(card);

  const saveBtn = el("button",{class:"btn",style:"margin-top:12px"},t("Save"));
  const status = el("span",{style:"margin-left:10px;color:#94a3b8;font-size:13px"});
  saveBtn.addEventListener("click", async ()=>{
    const selected = checks.filter(c => c.checked).map(c => c.dataset.tab);
    await ctx.actions.settingsSet({ advanced_extra_tabs: selected });
    status.textContent = t("Saved!");
    ctx.actions.renderNav();
    setTimeout(()=>{ status.textContent = ""; }, 2000);
  });
  wrap.appendChild(el("div",{style:"display:flex;align-items:center"}, [saveBtn, status]));

  // The Atlas and Live Aboard settings have their own tab (Settings → Atlas)
  // since 2026-10-30; this says where they went, for anyone who looks here.
  const atlasGo = el("button",{class:"btn inline","data-goto":"settings-atlas"},t("Open Settings \u2192 Atlas"));
  atlasGo.addEventListener("click", ()=>{ ctx.state._settingsTab = "atlas"; ctx.actions.renderRooms(); });
  wrap.appendChild(el("div",{class:"card","data-atlas-moved":"",style:"padding:12px 16px;margin-top:20px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"},[
    el("span",{style:"color:#94a3b8;font-size:13px"}, t("The Atlas, Live Aboard, wall screens and the Atlas as Overview are on the Atlas tab.")),
    atlasGo,
  ]));

  // ── Edition & tier ──
  // What this build is and what the key lets it do (licence.py). The reveal
  // switch exists only on a Bright build: hide-by-default, never hidden for
  // good. The tier override can only LOWER the effective tier — it is how a
  // Pro developer looks at what a free or Bright user sees, and never a way
  // past the licence.
  const edCard = el("div",{class:"card",style:"padding:16px;margin-top:20px"});
  const _ed = String(settings.edition || "full"), _tier = String(settings.tier || "free");
  edCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
    el("div",{style:"font-weight:700;font-size:14px;color:#a7f3d0;margin-bottom:6px"},t("Edition & tier")),
    ctx.helpers.helpBtn ? ctx.helpers.helpBtn("settings_ui") : null,
  ]));
  edCard.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:10px;line-height:1.5"},
    t("This build: {edition} · running at tier \"{tier}\"", { edition: _ed === "bright" ? "PadSpan Bright" : "PadSpan HA", tier: _tier }) +
    (settings.license_tier_override ? " " + t("(override: {tier})", { tier: settings.license_tier_override }) : "") + "."));
  if(_ed === "bright"){
    const revRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px"});
    const revCb = el("input",{type:"checkbox"});
    revCb.checked = !!settings.bright_reveal_presence;
    revCb.addEventListener("change", async ()=>{
      await ctx.actions.settingsSet({ bright_reveal_presence: revCb.checked });
      ctx.actions.renderNav();
    });
    revRow.appendChild(revCb);
    revRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, t("Show the presence tabs too (Overview, Follow, Calibration, …)")));
    edCard.appendChild(revRow);
  }
  if(ctx.state.complexity === "development"){
    const ovRow = el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap"});
    ovRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:13px"}, t("Look at this install as tier:")));
    const ovSel = document.createElement("select"); ovSel.className = "select";
    for(const [v,l] of [["",t("(no override)")],["free",t("free")],["bright","bright"],["pro","pro"]]){
      const o = document.createElement("option"); o.value = v; o.textContent = l; ovSel.appendChild(o);
    }
    ovSel.value = String(settings.license_tier_override || "");
    ovSel.addEventListener("change", async ()=>{
      await ctx.actions.settingsSet({ license_tier_override: ovSel.value });
      ctx.toast(ovSel.value ? t("Viewing as tier {tier} (lower only)", { tier: ovSel.value }) : t("Tier override cleared"));
      ctx.actions.renderRooms();
    });
    ovRow.appendChild(ovSel);
    ovRow.appendChild(el("span",{class:"muted",style:"font-size:11px"}, t("lowers only — the licence still decides upward")));
    edCard.appendChild(ovRow);
  }
  wrap.appendChild(edCard);

  return wrap;
}

// Scenes (2026-11-07, views/scene_row.js): the row under the Atlas is made of
// Home Assistant's scenes and the one-floor Whole house presets; a new scene
// is made in Home Assistant's own editor, which is an administrator's.
// i18n part: atlas
function _atlasScenesLine(ctx, el){
  const admin = !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
  const box = el("div",{"data-focus-part":"scenes",style:"margin-top:14px;padding-top:12px;border-top:1px solid #1e3a2a"});
  box.appendChild(el("div",{style:"color:#e2e8f0;font-size:14px"},t("Scenes")));
  box.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin:2px 0 8px;line-height:1.5"},
    t("The row of small maps under the Atlas (and in Live Aboard) shows Home Assistant's scenes that set a placed light, and the Whole house presets that light one floor. Tap one to run it, tap it again to turn its lights off. A screen can hide the row in Live Aboard's \u22ef list.")));
  if (!admin) {
    box.appendChild(el("div",{style:"font-size:12px;color:#94a3b8"},t("An administrator makes scenes in Home Assistant.")));
    return box;
  }
  // Home Assistant's own page, as the panel opens one (rooms.js): its router, else a plain load.
  const open = (path, word) => {
    if (word && ctx.actions.telemetryEvent) ctx.actions.telemetryEvent(word);
    try { history.pushState(null, "", path); window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } })); }
    catch (_) { try { window.location.assign(path); } catch (__) { /* stays here */ } }
  };
  const mk = el("button",{class:"btn inline","data-scene-new":"settings"},t("+ New scene in Home Assistant \u203a"));
  mk.addEventListener("click", ()=>open("/config/scene/edit/new", "house3d_show:scene_new:settings"));
  const all = el("button",{class:"btn inline"},t("All scenes \u203a"));
  all.addEventListener("click", ()=>open("/config/scene/dashboard", null));
  box.appendChild(el("div",{style:"display:flex;align-items:center;flex-wrap:wrap;gap:6px"},[mk, all]));
  return box;
}

// ── Atlas tab ────────────────────────────────────────────────────────────────
// The Atlas and Live Aboard settings, moved out of UI Structure as they were
// (2026-10-30): the same cards, rows, keys and saves.
function _settingsAtlas(ctx, el){
  const wrap = el("div",{});
  const settings = ctx.state.settings || {};
  wrap.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
    el("h3",{style:"color:#52b788;margin-bottom:8px"},t("Atlas")),
    ctx.helpers.helpBtn ? ctx.helpers.helpBtn("settings_atlas") : null,
  ]));
  wrap.appendChild(el("p",{style:"color:#94a3b8;font-size:13px;margin-bottom:0"},
    t("The Atlas (the house map for everyday light control) and Live Aboard, its 3D view.")));

  // ── The Atlas (was "Mapped Light Control Goodie") ──
  // The Atlas is on by default now (settings_store.py). Two switches that
  // behave differently, so each says how: the sidebar entry is registered at
  // setup (panel.py) and takes a restart after Save; the emergency button is
  // read by the Atlas on its next refresh, so it saves the moment it changes.
  const lightsCard = el("div",{class:"card",style:"padding:16px;margin-top:20px"});
  lightsCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;color:#fbbf24;margin-bottom:6px"},t("\uD83D\uDCA1 Atlas \u2014 Mapped Light Control")));
  lightsCard.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:10px;line-height:1.5"},
    t("The house map for everyday light control, as its own entry in the Home Assistant sidebar. On by default.")));
  const lightsRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer"});
  const lightsCb = el("input",{type:"checkbox"});
  lightsCb.checked = !!(settings.lights_panel_enabled);
  lightsRow.appendChild(lightsCb);
  lightsRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, t("Show the Atlas in the Home Assistant sidebar")));
  lightsCard.appendChild(lightsRow);
  lightsCard.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin:2px 0 0 24px"},
    t("Save, then restart Home Assistant for this one to take effect.")));
  const lightsSaveBtn = el("button",{class:"btn inline",style:"margin-top:10px"},t("Save"));
  const lightsStatus = el("span",{style:"margin-left:10px;color:#94a3b8;font-size:13px"});
  lightsSaveBtn.addEventListener("click", async ()=>{
    await ctx.actions.settingsSet({ lights_panel_enabled: lightsCb.checked });
    lightsStatus.textContent = lightsCb.checked
      ? t("Saved \u2014 restart Home Assistant to see the Atlas in the sidebar.")
      : t("Saved \u2014 restart Home Assistant to remove the Atlas from the sidebar.");
    lightsStatus.style.color = "#fbbf24";
  });
  lightsCard.appendChild(el("div",{style:"display:flex;align-items:center;flex-wrap:wrap"}, [lightsSaveBtn, lightsStatus]));
  // The Atlas's red "Test emergency lighting" button — shown only when the
  // house has emergency lights; this hides it even then (never while a test
  // runs). Saved on its own the moment it changes.
  const emergRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:14px;padding-top:12px;border-top:1px solid #1e3a2a"});
  const emergCb = el("input",{type:"checkbox"});
  emergCb.checked = settings.atlas_emergency_button !== false;
  emergRow.appendChild(emergCb);
  emergRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, t("Show the Test emergency lighting button on the Atlas")));
  lightsCard.appendChild(emergRow);
  const emergNote = el("div",{style:"font-size:11px;color:#94a3b8;margin:2px 0 0 24px"},
    t("Saves as soon as you tick or untick it. No restart needed."));
  lightsCard.appendChild(emergNote);
  emergCb.addEventListener("change", async ()=>{
    const want = emergCb.checked;
    try {
      // Straight to the wire, NOT settingsSet: that re-renders the whole
      // Settings view at once, which would throw away any other change on
      // this page that hasn't been saved yet (and this note with it).
      const r = await ctx.actions.wsCall("padspan_ha/settings_set", { atlas_emergency_button: want });
      if (r && r.settings && ctx.state) ctx.state.settings = r.settings;
      emergNote.textContent = want ? t("Saved \u2014 the button comes back on the Atlas at its next refresh.")
        : t("Saved \u2014 the button leaves the Atlas at its next refresh.");
    } catch (e) {
      emergCb.checked = !want;
      ctx.toast(t("Could not save: {why}", { why: ctx.helpers.errorText(e) }), true);
    }
  });
  // Lights in their own colours on the working Atlas (Showcase always does).
  // Off by default: the map everyone knows stays amber until asked.
  const colRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:10px"});
  const colCb = el("input",{type:"checkbox"});
  colCb.checked = settings.atlas_live_colours === true;
  colRow.appendChild(colCb);
  colRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, t("Draw lit lights in their own colour on the Atlas (a colour bulb's colour, a white bulb's warm or cool)")));
  lightsCard.appendChild(colRow);
  const colNote = el("div",{style:"font-size:11px;color:#94a3b8;margin:2px 0 0 24px"}, t("Off: lit lights are amber, as always. Showcase always uses their colours."));
  lightsCard.appendChild(colNote);
  colCb.addEventListener("change", async ()=>{
    const want = colCb.checked;
    try {
      const r = await ctx.actions.wsCall("padspan_ha/settings_set", { atlas_live_colours: want });
      if (r && r.settings && ctx.state) ctx.state.settings = r.settings;
      colNote.textContent = t("Saved \u2014 the Atlas changes at its next refresh.");
    } catch (e) {
      colCb.checked = !want;
      ctx.toast(t("Could not save: {why}", { why: ctx.helpers.errorText(e) }), true);
    }
  });
  // Alert pulse, normally off: a door, window, gate or cover left open for more
  // than 6 hours, or a window or cover open in the rain or snow, rings its room
  // in amber (lights_map.js safetyAlerts; a leak, smoke, gas or CO alarm
  // already rings red), and a wall screen names the worst one across its top.
  const pulseRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:14px;padding-top:12px;border-top:1px solid #1e3a2a"});
  const pulseCb = el("input",{type:"checkbox"});
  pulseCb.checked = settings.atlas_alert_pulse === true;
  pulseRow.appendChild(pulseCb);
  pulseRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, t("Alert pulse")));
  lightsCard.appendChild(pulseRow);
  const pulseNote = el("div",{style:"font-size:11px;color:#94a3b8;margin:2px 0 0 24px"},
    t("A door, window, gate or cover left open for more than 6 hours, or a window or cover open while it rains or snows, rings its room in amber. On a wall screen (?kiosk=1) a banner across the top names the worst alert and where it is (“Leak · Laundry”) until it clears. Saves as soon as you tick or untick it."));
  lightsCard.appendChild(pulseNote);
  pulseCb.addEventListener("change", async ()=>{
    const want = pulseCb.checked;
    try {
      // Straight to the wire, as the emergency button's box above.
      const r = await ctx.actions.wsCall("padspan_ha/settings_set", { atlas_alert_pulse: want });
      if (r && r.settings && ctx.state) ctx.state.settings = r.settings;
      pulseNote.textContent = want ? t("Saved — the Atlas shows alerts from its next refresh.")
        : t("Saved — the Atlas stops showing alerts at its next refresh.");
    } catch (e) {
      pulseCb.checked = !want;
      ctx.toast(t("Could not save: {why}", { why: ctx.helpers.errorText(e) }), true);
    }
  });
  // A leak, smoke, gas or CO alarm that latches (the red ring above) sends one
  // notification, and one when it clears: emergency_notify, on by default
  // (flood_latch.py; where Follow alerts go, auto-picked when none is set).
  const alarmRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:10px","data-settings":"emergency-notify"});
  const alarmCb = el("input",{type:"checkbox"});
  alarmCb.checked = settings.emergency_notify === true;
  alarmRow.appendChild(alarmCb);
  alarmRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, t("Notify when a leak, smoke, gas or CO alarm goes off")));
  lightsCard.appendChild(alarmRow);
  const alarmNote = el("div",{style:"font-size:11px;color:#94a3b8;margin:2px 0 0 24px"},
    t("One notification when the alarm goes off and one when it clears (reset in the Atlas, or after 2 days), never more while it stays on. It goes where your Follow alerts go. With none set, it goes to the first notification service Home Assistant has, a mail one first; with none in Home Assistant, nothing is sent."));
  lightsCard.appendChild(alarmNote);
  alarmCb.addEventListener("change", async ()=>{
    const want = alarmCb.checked;
    try {
      const r = await ctx.actions.wsCall("padspan_ha/settings_set", { emergency_notify: want });
      if (r && r.settings && ctx.state) ctx.state.settings = r.settings;
      alarmNote.textContent = want ? t("Saved: alarms send a notification from now on.") : t("Saved: alarms send no notification from now on.");
    } catch (e) {
      alarmCb.checked = !want;
      ctx.toast(t("Could not save: {why}", { why: ctx.helpers.errorText(e) }), true);
    }
  });
  // The ♨ Heatmap chip, normally off: with it on, the Atlas's layer bar offers
  // temperature, humidity and CO2 drawn across each room from its own sensors.
  // PadSpan Pro's (2026-10-22): below Pro, no row at all, and whatever
  // is stored is kept for when a key comes back (as the 3D house's below).
  if (tierAtLeast(currentTier(settings), "pro")) {
  const heatRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:10px"});
  const heatCb = el("input",{type:"checkbox"});
  heatCb.checked = settings.atlas_heatmap_enabled === true;
  heatRow.appendChild(heatCb);
  heatRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, t("Heatmap chip on the Atlas (temperature, humidity, CO\u2082)")));
  lightsCard.appendChild(heatRow);
  const heatNote = el("div",{style:"font-size:11px;color:#94a3b8;margin:2px 0 0 24px"},
    t("Adds a \u2668 chip to the Atlas's layer bar; each room takes its colour from its own sensors only. Off: no chip."));
  lightsCard.appendChild(heatNote);
  heatCb.addEventListener("change", async ()=>{
    const want = heatCb.checked;
    try {
      const r = await ctx.actions.wsCall("padspan_ha/settings_set", { atlas_heatmap_enabled: want });
      if (r && r.settings && ctx.state) ctx.state.settings = r.settings;
      heatNote.textContent = t("Saved \u2014 the Atlas changes at its next refresh.");
    } catch (e) {
      heatCb.checked = !want;
      ctx.toast(t("Could not save: {why}", { why: ctx.helpers.errorText(e) }), true);
    }
  });
  }
  lightsCard.appendChild(_atlasScenesLine(ctx, el));
  lightsCard.appendChild(_atlasWeatherSection(ctx, el, settings));
  // Power teams (power_team.py, the full edition's): a wall dimmer and the smart bulbs it feeds, as one light.
  if (POWER_TEAMS && String(settings.edition || "full").toLowerCase() !== "bright") lightsCard.appendChild(POWER_TEAMS.powerTeamsSection(ctx, el));
  // The 3D house is Pro's (PadSpan Pro and Bright Pro): below Pro, no box at
  // all, and whatever is stored is kept for when a key comes back.
  if (tierAtLeast(currentTier(settings), "pro")) lightsCard.appendChild(_atlas3dSection(ctx, el, settings));
  wrap.appendChild(lightsCard);
  // 📺 Wall screens: how big a ?kiosk=1 wall draws, for its room. Not on a
  // Bright install that can't unlock it (wall mode is PadSpan Pro's).
  if (WALLCARD && !(String(settings.edition || "").toLowerCase() === "bright" && !tierAtLeast(currentTier(settings), "pro"))) {
    try { wrap.appendChild(WALLCARD.wallCard(ctx, el, settings)); } catch (e) { console.warn("PadSpan: wall screens card", e); }
  }
  if (SCREENSCARD) {
    try { wrap.appendChild(SCREENSCARD.screensCard(ctx, el, settings, (ctx.state.versionInfo && ctx.state.versionInfo.build_id) || "")); } catch (e) { console.warn("PadSpan: open screens card", e); }
  }

  // ── The Atlas as Overview (Pro) ──
  // Overview (first in the menu) shows the Atlas instead of the classic map;
  // Pure Live (below it) gets a switch to the classic Overview. Saved the
  // moment it changes; nothing to restart. Not on a Bright build that hides
  // Overview (a presence surface) — there is no Overview there to change.
  const ovShown = surfacesForEdition(["overview"], settings).length > 0;
  const ovPro = tierAtLeast(settings.tier, "pro");
  const ovCard = el("div",{class:"card","data-focus-part":"atlas_overview",style:"padding:16px;margin-top:20px"});
  ovCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;color:#52b788;margin-bottom:6px"},t("\uD83D\uDDFA\uFE0F Overview \u2014 the Atlas as your main map")));
  ovCard.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:10px;line-height:1.5"},
    t("Overview, the first tab, shows the Atlas (your lights, devices and rooms, and Live Aboard if it's on) instead of the classic map. The classic Overview moves under Live Tracker, which gets a switch between the two.")));
  const ovRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:" + (ovPro ? "pointer" : "not-allowed")});
  const ovCb = el("input",{type:"checkbox"});
  ovCb.checked = ovPro && settings.overview_atlas === true;
  ovCb.disabled = !ovPro;
  ovRow.appendChild(ovCb);
  ovRow.appendChild(el("span",{style:"color:" + (ovPro ? "#e2e8f0" : "#64748b") + ";font-size:14px"}, t("Show the Atlas as Overview")));
  ovCard.appendChild(ovRow);
  const ovNote = el("div",{style:"font-size:11px;color:#94a3b8;margin:2px 0 0 24px"},
    ovPro ? t("Saves right away.") : t("PadSpan Pro (Settings \u2192 PadSpan licence)."));
  ovCard.appendChild(ovNote);
  ovCb.addEventListener("change", async ()=>{
    try {
      await ctx.actions.settingsSet({ overview_atlas: ovCb.checked });
      ctx.state._liveClassic = false;
      ovNote.textContent = ovCb.checked
        ? t("Saved \u2014 Overview now shows the Atlas; the classic Overview is under Live Tracker.")
        : t("Saved \u2014 Overview is back to the classic map.");
      ovNote.style.color = "#52b788";
    } catch (e) {
      ovCb.checked = !ovCb.checked;
      ovNote.textContent = t("Could not save: {why}", { why: String(e && e.message || e) });
      ovNote.style.color = "#f87171";
    }
  });
  if (ovShown) wrap.appendChild(ovCard);

  return wrap;
}
