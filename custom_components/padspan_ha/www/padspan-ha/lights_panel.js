// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/*
  PadSpan HA — Lights Control Panel
  ===================================
  Standalone HA sidebar panel: full-house light control on the same isometric
  3D floor-stack view used by the Overview tab.
  Tap a hexagon or table row to toggle a light on/off.

  BUILD_ID / APP_VERSION updated automatically by scripts/release.py.
*/

const APP_VERSION = "0.38.305";
const BUILD_ID = "20261126T220834Z";

// The stamp on every import below: the b of this module's own URL and nothing
// else. Home Assistant loads this page with ?v=...&b=... and the panel's
// Overview loads it with ?b=... alone; passing the whole query on would have
// the two ask for every file under two addresses and run two copies of each
// (see docs/06_UI_CACHE_BUSTING.md).
const STAMP = ((b) => (b ? `?b=${b}` : ""))(new URL(import.meta.url).searchParams.get("b"));
// Its words in the panel's language (views/i18n.js; English is the key). The same module the views import (the same
// stamp), so the language this page loads in set hass is the one they all speak.
const I18N = await import(`./views/i18n.js${STAMP}`);
const { t, tn } = I18N;
// The groups this page and what it shows speak (scripts/i18n_coverage.py says which files each holds).
const I18N_GROUPS = ["panel", "atlas1", "atlasmap", "atlasmap2", "aboard", "aboard2", "server"];
const { hasControlCard, hasFixedGlyph, isControllable } =
  await import(`./views/light_codes.js${STAMP}`);
// THE shared lights view — data pipeline, map card and index table, also used
// verbatim by the Mapping → Lights tab (the builder for this display), so the
// two tools always show the identical map. All lights-view edits go in there.
const { ensureLightsRegistry, gatherLights, buildLightsMapCard, buildLightsTable, lightIsTouched,
        sunAmbient, toggleEntity, atlasLookFromSettings,
        wireUseSurface, tapSwitches, openControlCard, controlApiFor, openRoomSheet, openFloorSheet, openLightsSheet, openActivityCalendar, setManyStates, doorInvertOf,
        wireHoverHud, screenHeight, captureWholeHouse, applyWholeHouse, ensureExactDevices,
        vacationOptionsOf, vacationEndsText, layChildren, screenShowLine, carryShowLine, peopleShownOn, withoutZigbeeDuplicates, confirmAsk, placeRoomDevices } =
  await import(`./views/lights_map.js${STAMP}`);
// Which add-ons this install has (views/editions.js addonAllowed, the backend's
// own answer, settings.addons_licensed): this page asks _addon(name).
// And the ladder's rungs for the features that can move down it (licence.py FREE_BASICS).
const { addonAllowed, tierAtLeast, freeBasics, placementTier, wallTier } = await import(`./views/editions.js${STAMP}`);
// The house's alarm on the emergency button (views/alarm_panel.js). Optional:
// without it the button is as it was.
const ALARM = await import(`./views/alarm_panel.js${STAMP}`)
  .catch(err => { console.warn("PadSpan: alarm_panel failed to load", err); return null; });
// Room controls (views/room_controls.js): the ⋯ list's "Room controls", a room's
// players, shades and thermostats in its sheet. Optional: without it the line
// is not offered and the sheet is as it was.
const ROOMCTL = await import(`./views/room_controls.js${STAMP}`)
  .catch(err => { console.warn("PadSpan: room_controls failed to load", err); return null; });
// Room controls' settings as the module reads them, from what the settings command said (s); a key it did not say
// keeps what was there (was): a save of the owner's sources alone keeps the matches.
const roomAudioOf = (s, was = {}) => {
  const has = (k) => s && s[k] !== undefined;
  return { room_audio_matches: has("room_audio_matches") ? (s.room_audio_matches || {}) : (was.room_audio_matches || {}),
    room_audio_ha_speakers: has("room_audio_ha_speakers") ? s.room_audio_ha_speakers === true : was.room_audio_ha_speakers === true,
    room_audio_matched: has("room_audio_matched") ? s.room_audio_matched === true : was.room_audio_matched === true,
    room_audio_sources: has("room_audio_sources") ? (s.room_audio_sources || {}) : (was.room_audio_sources || {}),
    room_audio_limits: has("room_audio_limits") ? (s.room_audio_limits || {}) : (was.room_audio_limits || {}) };
};
// Escape, Tab and the focus for the emergency card and the page drawn again
// (views/dialog_keys.js). Optional: without it they work as they did.
const KEYS = await import(`./views/dialog_keys.js${STAMP}`)
  .catch(err => { console.warn("PadSpan: dialog_keys failed to load", err); return null; });
const { keepSubscribed } =
  await import(`./views/push_subscription.js${STAMP}`);
// This page as an open screen (screens.py, off by default). Optional: if it
// fails to load, the page simply isn't listed.
const SCREENS = await import(`./views/screens_client.js${STAMP}`)
  .catch(err => { console.warn("PadSpan: screens_client failed to load", err); return null; });
// Wall mode's numbers. Optional: if the file can't load, the Atlas page runs
// as an ordinary page (no wall mode) rather than not at all.
const WALLS = await import(`./views/wall_scale.js${STAMP}`)
  .catch(err => { console.warn("PadSpan: wall_scale failed to load", err); return null; });
// Hide HA / Show HA beside Refresh, shared with the panel's toolbar. Optional:
// without it the button is simply not there.
const HA_SIDEBAR = await import(`./ha_sidebar.js${STAMP}`)
  .catch(err => { console.warn("PadSpan: ha_sidebar failed to load", err); return null; });
// The 90-day trial card, shared with every other paid wall. Optional: a card
// that fails to load must not blank the house map.
const { trialOfferCard } = await import(`./views/trial_offer.js${STAMP}`)
  .catch(err => { console.warn("PadSpan: trial_offer failed to load", err); return { trialOfferCard: () => null }; });
// Which PadSpan module an uncaught error came from (see panel.js "Uncaught
// panel errors"). Not awaited: the sidebar must come up without it.
let UI_ERROR = null;
import(`./views/ui_error.js${STAMP}`)
  .then(m => { UI_ERROR = m; })
  .catch(err => console.warn("PadSpan: ui_error module failed to load", err));

// ── DOM helpers ──────────────────────────────────────────────────────────────
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(k==="class")  n.className = v;
    else if(k==="id") n.id = v;
    else if(k==="style") n.setAttribute("style", v);
    else if(k.startsWith("on") && typeof v==="function") n.addEventListener(k.slice(2), v);
    else if(v!==undefined && v!==null) n.setAttribute(k, String(v));
  }
  if(!Array.isArray(children)) children=[children];
  for(const c of children){
    if(c===null||c===undefined) continue;
    if(typeof c==="string"||typeof c==="number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}
// isWledLight / isPartitionLight come from views/light_codes.js — a strip's
// TWO classes: WLED-class advertises an effect list; partition-class is an
// ESPHome-style `light.partition` entity (a physical strip split by LED
// range), signalled by the entity registry rather than by effects, since
// most partitions carry none. Both get the long-press detail popup below —
// and so does any plain DIMMABLE light (l.dimmable from the shared
// pipeline): the popup is capability-driven, so a hold on a dimmer offers
// brightness where a strip also offers colour and effects. Everything else
// this panel shows (registry pipeline, map card, index table) lives in
// views/lights_map.js, shared with the Mapping → Lights tab.

// ── Persistence keys ─────────────────────────────────────────────────────────
// What to do when the backend isn't the build this page loaded (the same
// function as panel.js, held equal by tests/test_stale_build.py). A wall
// screen left on the Atlas through an update kept running the old Atlas
// against the new backend until someone reloaded it (2026-10-19): the Atlas
// had no build check at all. A wall screen reloads itself, once per build.
function staleBuildAction(pageBuild, backendBuild, kiosk, reloadedFor){
  if(!pageBuild || !backendBuild || pageBuild === backendBuild) return null;
  const newer = backendBuild > pageBuild;
  return { newer, reload: newer && !!kiosk && reloadedFor !== backendBuild };
}
// Wall mode (?kiosk=1, 2026-10-21): how big to draw is views/wall_scale.js,
// shared with Settings → UI Structure → Wall screens.

// A wall screen: ?kiosk=1, or a window that fills the screen (Chrome
// --kiosk, a full-screen tablet), which nobody is there to press Reload on.
// The same test trial_offer.js newTabOk makes, the other way round.
function wallScreen(kiosk, win = globalThis){
  if(kiosk) return true;
  try {
    const s = win.screen;
    return !!(s && win.innerWidth >= s.width - 1 && win.innerHeight >= s.height - 1);
  } catch(e) { return false; }
}
// The last time anybody touched this screen. A full-screen window may be a
// tablet somebody is using (or a desktop at F11), so it reloads itself only
// after two minutes with nobody at it; ?kiosk=1 reloads straight away.
let _lastInputAt = Date.now();
for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) {
  try { globalThis.addEventListener(ev, () => { _lastInputAt = Date.now(); }, { capture: true, passive: true }); } catch(e) {}
}
function untouchedFor(ms){
  return Date.now() - _lastInputAt >= ms;
}
// What kind of screen this is, for the opt-in report (wall_screen:*): does
// the full-screen rule above find real wall screens, or desktops at F11?
function screenKind(kiosk, win = globalThis){
  if(kiosk) return "kiosk";
  if(!wallScreen(false, win)) return "windowed";
  return untouchedFor(120000) ? "fullscreen_idle" : "fullscreen_used";
}
// How a self-reload went, for the opt-in report (wall_reload:*). The page
// that reloaded wrote "<panel>:<kiosk|fullscreen>" beside padspan_reloaded_for;
// the page that comes back is the build it went for, or still the old one.
function reloadOutcome(panel, pageBuild, reloadedFor, how){
  if(!how || !reloadedFor || !how.startsWith(panel + ":")) return null;
  if(reloadedFor === pageBuild) return how.slice(panel.length + 1);
  return reloadedFor > pageBuild ? "stuck" : null;
}
// Read once per page load: this panel's self-reload, if it just made one.
const _PAGE_START = Date.now();
let _reloadNote = null, _screenReported = false;
try {
  const how = sessionStorage.getItem("padspan_reload_how") || "";
  _reloadNote = reloadOutcome("atlas", BUILD_ID, sessionStorage.getItem("padspan_reloaded_for") || "", how);
  if (_reloadNote) sessionStorage.removeItem("padspan_reload_how");
} catch(e) {}

const NO_FLOORS = [];
const LS_HIDDEN = "padspan_ha_lights_hidden";
// The one-time coach mark ("tap to switch · code or hold for controls") —
// per browser, because that is where the hands are.
const LS_COACH = "padspan_ha_lights_coach_seen";
const LS_CLASS = "padspan_ha_lights_class";
const LS_HEAT = "padspan_ha_lights_heatmap";
// "Not now" on the trial card — per browser, like the coach mark: this panel
// is often a wall screen, and an offer nobody there can act on stays hidden.
const LS_TRIAL_HIDDEN = "padspan_ha_lights_trial_hidden";

// ── Custom element ────────────────────────────────────────────────────────────
class PadSpanLightsApp extends HTMLElement {
  constructor(){
    super();
    this._hass   = null;
    this._booted = false;
    this._pollTimer = null;
    this.state = {
      model:       { areas:[], floors:[] },
      _modelLoaded: false,
      _hiddenMapIds: new Set(),
      _hidden:     this._loadHidden(),
      // Layer chips: which device class is in front. Remembered per browser.
      _classFilter: (()=>{ try{ return localStorage.getItem(LS_CLASS)||"all"; }catch(_){ return "all"; } })(),
      _heatmap: (()=>{ try{ return localStorage.getItem(LS_HEAT)||null; }catch(_){ return null; } })(),
      _coachSeen:   (()=>{ try{ return localStorage.getItem(LS_COACH)==="1"; }catch(_){ return false; } })(),
      _trialHidden: (()=>{ try{ return localStorage.getItem(LS_TRIAL_HIDDEN)==="1"; }catch(_){ return false; } })(),
    };
    // Registry cache owned here, filled by the shared ensureLightsRegistry.
    this._regStore = {};
    // Live view settings for the shared map card (persist across renders).
    this._view = { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1.0 };

    // Custom-element upgrade race: HA can set .hass on this element before
    // the browser finishes upgrading it to this class (the defining module
    // loads async over the network), which creates a plain instance
    // property that permanently shadows the `hass` accessor below — _boot()
    // would then never run and the panel stays blank forever. Reclaim any
    // pre-upgrade value through the accessor now that our class has taken over.
    if (Object.prototype.hasOwnProperty.call(this, "hass")) {
      const preUpgradeHass = this.hass;
      delete this.hass;
      this.hass = preUpgradeHass;
    }
  }

  _loadHidden(){
    try{ return new Set(JSON.parse(localStorage.getItem(LS_HIDDEN)||"[]")); }catch(_){ return new Set(); }
  }
  _saveHidden(){
    const arr = [...this.state._hidden];
    try{ localStorage.setItem(LS_HIDDEN, JSON.stringify(arr)); }catch(_){}
    // Also persist to HA backend so it survives across devices/reboots
    if(this._hass){
      try{ this._ws({ type:"padspan_ha/settings_set", lights_hidden: arr }); }catch(_){}
    }
  }

  set hass(hass){
    const was = this._hass;
    this._hass = hass;
    // The page's words in the profile's language: asked once per language, and the page is drawn again when a
    // language other than the one shown has come in. English fetches nothing and draws nothing again.
    const lang = hass ? I18N.langOf(hass) : null;
    if(hass && lang !== this._langSeen){
      this._langSeen = lang;
      I18N.useLanguage(hass, I18N_GROUPS).then((got)=>{
        if(got === (this._langShown || "en")) return;
        this._langShown = got;
        if(this._booted) this._render();
      }).catch(err => console.warn("PadSpan: Atlas translation failed to load", err));
    }
    if(this._haBtn && HA_SIDEBAR && hass && (!was || was.dockedSidebar !== hass.dockedSidebar)){
      this._haBtn.textContent = HA_SIDEBAR.haLabel(hass);
      this._haBtn.setAttribute("aria-pressed", String(HA_SIDEBAR.haHidden(hass)));
    }
    if(!this._booted){ this._booted=true; this._boot(); }
    // Motion sensors back from an offline blip (motion_reconnects.py), pushed
    // on every change — one subscription per connection, kept across HA
    // restarts (push_subscription.js). A push once settings have landed
    // redraws (a boot draws with whatever is here), so a blip never shows
    // for even one poll.
    if(hass && hass.connection && this._reconnectsConn !== hass.connection){
      if(this._reconnectsStop) this._reconnectsStop();
      this._reconnectsConn = hass.connection;
      this._reconnectsStop = keepSubscribed(hass.connection, { type:"padspan_ha/motion_reconnects" },
        m => { this.state._motionReconnects = m || {}; if(this._settingsTs) this._poll(); });
    }
    this._screenSync();
  }

  /** Join or leave the open screens (screens.py) as the setting says. Not as
   *  the panel's Overview (_embedded): the panel is the screen there. */
  _screenSync(){
    if(!SCREENS || this._embedded) return;
    if(!this._screen) this._screen = SCREENS.createScreen("atlas",
      () => ({ build: BUILD_ID, kiosk: this._kiosk(), view: "atlas" }), keepSubscribed);
    this._screen.sync(this.isConnected && this._hass ? this._hass.connection : null, this._screensOn === true);
  }

  async _boot(){
    if(!this._hass) return;
    // The header Refresh button re-boots — without this, each click leaves
    // its predecessor's 5s interval running forever (they can only ever be
    // cleared one deep), multiplying full re-renders and churning the DOM
    // mid-interaction.
    if(this._pollTimer){ clearInterval(this._pollTimer); this._pollTimer=null; }
    // Refresh reads Live Aboard's file again too (the flat map's kinds and furniture).
    this._shownAt = Date.now();
    // Maps + settings are small and fast — render the floor/room shapes on
    // those alone first. The entity/device registry (needed only to know
    // which room each light is in) is a multi-MB whole-house dump on a
    // large install; don't block first paint on it — the shared
    // ensureLightsRegistry backfills it in the background from _buildUI
    // (guarded on the model so area NAMES exist before the map is built).
    await Promise.allSettled([ this._loadSettings() ]);
    this._settingsTs = Date.now();
    this._render();
    this._loadEmergency().then(()=>this._render());
    // The saved floor comes into view once, on the card the new model makes
    // (lights_map.js). A failed read makes none: the request goes with it, or
    // some later card would move the page.
    this._loadModel().then(()=>{ this._render(); this._view.scrollToChosen = false; });
    // Clear again AFTER the awaits: two overlapping boots (a second Refresh
    // click while the first is still loading) both pass the clear above before
    // either assigns, and the first timer would be orphaned beyond reach.
    if(this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(()=>this._poll(), 5000);
    if(!this._screenTimer && !this._embedded) this._screenTimer = setTimeout(()=>this._screenReport(), Math.max(0, 150000 - (Date.now() - _PAGE_START)));
  }

  // What kind of screen this is and how a self-reload went (screenKind,
  // reloadOutcome), once per page load, after the two idle minutes a
  // full-screen window needs to count as a wall. Only with the report on.
  _screenReport(){
    if(_screenReported || !this._hass || !this.state._telemetryOn) return;
    _screenReported = true;
    let kiosk = false;
    try { kiosk = new URLSearchParams(location.search).get("kiosk") === "1"; } catch(_) {}
    const send = (name, screen)=>{ Promise.resolve(this._ws({ type:"padspan_ha/telemetry_event", event:name, ...(screen || {}) })).catch(()=>{}); };
    // With the screen id (read, never made): its word in the report's list of screens.
    let sid = null;
    try { sid = localStorage.getItem("padspan_screen_id"); } catch(_) {}
    send("wall_screen:atlas:" + screenKind(kiosk), /^[0-9a-f]{16}$/.test(sid || "") ? { screen: sid } : null);
    // Wall mode (_wallOn): the scale it runs at, and whether the screen is
    // kept awake (Wake Lock needs HTTPS or localhost).
    if(this.hasAttribute("data-wall")){
      const s = this._wallUi || 1;
      send("wall_ui:" + (s < 1.25 ? "1" : s < 1.75 ? "1.5" : s < 2.5 ? "2" : s < 3.5 ? "3" : s < 5 ? "4" : "6"));
      send("wall_fit:" + (this._wallFit === "room" ? "room" : "auto"));
      send("wall_awake:" + (this._wakeLock && !this._wakeLock.released ? "on" : "off"));
      // How full the wall's flat map opened (views/atlas_fit.js, read off the
      // stage): fine, far back, or far back and moved in by the wall itself.
      const st = this.shadowRoot ? this.shadowRoot.querySelector(".lv-stage[data-fill-ratio]") : null;
      if(st) send("wall_fill:" + (st.dataset.fillCloser === "1" ? "closer" : st.dataset.fillLow === "1" ? "low" : "ok"));
    }
    if(_reloadNote) send("wall_reload:atlas:" + _reloadNote);
  }

  async _poll(){
    if(!this._hass) return;
    // Optimize for scale (Settings): nothing while the page is hidden.
    if(this.state._optimizeScale && document.visibilityState === "hidden") return;
    // Don't rebuild the DOM under the user's hands: a poll landing mid-drag on
    // a slider, or while a select is open, destroys the control being used.
    // (The Mapping tab's host has the same protection via _editDragging.)
    // INPUT/SELECT only. A button KEEPS focus after it is clicked, so
    // including BUTTON here meant one press of Zoom+ stopped this panel
    // live-updating for good.
    const active = this.shadowRoot && this.shadowRoot.activeElement;
    if(active && /^(INPUT|SELECT)$/.test(active.tagName)) return;
    // ... and a hold no one ends within 30 s is taken as over (a wall screen
    // must never stop updating for good).
    if(this._pointerDown && Date.now() - (this._pointerDownAt || 0) < 30000) return;
    // The build check, every 10 minutes (staleBuildAction above). Not as the
    // panel's Overview (_embedded): the panel runs its own.
    if(!this._embedded && Date.now() - (this._versionTs || 0) > 600000){
      this._versionTs = Date.now();
      this._ws({ type:"padspan_ha/version" }).then(vi => {
        const be = (vi && typeof vi.build_id === "string") ? vi.build_id : "";
        let reloadedFor = "";
        try { reloadedFor = sessionStorage.getItem("padspan_reloaded_for") || ""; } catch(_) {}
        let kiosk = false;
        try { kiosk = new URLSearchParams(location.search).get("kiosk") === "1"; } catch(_) {}
        const wall = kiosk || (wallScreen(false) && untouchedFor(120000));
        const act = staleBuildAction(BUILD_ID, be, wall, reloadedFor);
        if(act && act.reload){
          let remembered = false;
          try {
            sessionStorage.setItem("padspan_reloaded_for", be); remembered = true;
            sessionStorage.setItem("padspan_reload_how", "atlas:" + (kiosk ? "kiosk" : "fullscreen"));
          } catch(_) {}
          if(remembered) location.reload();   // can't remember it: don't risk a loop
        }
      }).catch(() => {});
    }
    // Hidden lights / hidden maps live in settings and are edited from the
    // Mapping tab. Without re-reading them, the two "identical" views drift
    // apart until this panel is reloaded.
    if(Date.now() - (this._settingsTs || 0) > 30000){
      this._settingsTs = Date.now();
      await this._loadSettings(false);
    }
    // The emergency lighting test's state — another browser (the wall
    // kiosk, a phone) can start or end it. Every 10 s while the house has
    // emergency lights and the button shows; every 5 minutes without any
    // (or an older backend), or while Settings hides the button — slow, but
    // still asked, so a test started elsewhere brings the button back —
    // plus on load and on Refresh (_boot).
    const emerg = this.state._emerg;
    const emergShown = !this.state._emergButtonHidden || !!(emerg && emerg.test && emerg.test.active);
    const emergEvery = (emerg && emerg.available && emergShown) ? 10000 : 300000;
    if(Date.now() - (this._emergTs || 0) > emergEvery) await this._loadEmergency();
    this._pollRender = true;
    try { this._render(); }   // registry staleness handled inside _buildUI
    finally { this._pollRender = false; }
  }

  async _loadModel(){
    try{
      const res = await this._ws({ type:"padspan_ha/model_get" });
      // Keep the WHOLE model payload. This panel used to copy four fields by
      // name, so when placed light positions moved into the model the sidebar
      // silently kept showing every light auto-clustered at its room centre
      // while the Mapping tab drew them at their real positions — the exact
      // display-vs-builder divergence the shared renderer exists to prevent.
      // A field the renderer needs must never depend on this host remembering
      // to list it.
      this.state.model = {
        ...(res || {}),
        areas: res?.areas||[], floors: res?.floors||[],
        room_geometry_m: res?.room_geometry_m||{},
        light_positions_m: res?.light_positions_m||{},
      };
    }catch(e){}
    // Registry area-name resolution waits on this flag (success OR failure) —
    // building the areaMap before areas load would mark every light
    // unassigned and then cache that for 60s.
    this.state._modelLoaded = true;
  }

  // applyView=false on the periodic refresh: the sliders are live UI state
  // the user may be mid-way through adjusting, and re-seeding them from the
  // saved settings would silently revert unsaved Spacing / L-R / Floor
  // changes every 30 seconds. Only the boot load seeds the view.
  async _loadSettings(applyView=true){
    let s = {};
    // A failed settings_get must still leave the hidden-maps fallback below
    // reachable — otherwise a transient websocket error makes this panel
    // render maps the Mapping tab hides, for the whole session.
    try{
      const res = await this._ws({ type:"padspan_ha/settings_get" });
      s = res?.settings || {};
      if(res && res.settings){ this._screensOn = s.screens_remote_enabled === true; this._screenSync(); }
    }catch(e){}
    try{
      if(applyView){
        // A wall arranges its floors for its own shape (views/atlas_fit.js) and
        // leaves the saved spacing, which is the other screens', alone.
        if(!this._wallFitted()){
          this._view.floorGap = s.overview_iso_floor_gap ?? 150;
          this._view.horizGap = s.overview_iso_horiz_gap ?? 0;
        }
        this._view.focusIdx = s.overview_iso_focus     ?? 0;
        // Persisted zoom (2026-09-22: "stabilize the zoom in, so when
        // that is locked well, it can stay that way for months") — this
        // panel is set up once and left running unattended; an in-memory
        // zoom reset to 1.0 on every reboot/reload.
        this._view.zoom     = s.overview_iso_zoom      ?? 1.0;
        // When the page opens, and never again: not on Refresh, which comes here too.
        if(!this._openScrollAsked){ this._openScrollAsked = true; this._view.scrollToChosen = true; }
      }
      // Per-light shape overrides — set in the Mapping → Lights tab, read here
      // so both views draw the same fixture outlines.
      this.state._shapeOverrides = (s.light_shapes && typeof s.light_shapes === "object") ? s.light_shapes : {};
      // Read for display parity with the Mapping tab (the only place they
      // are edited): a light forced to a class there must wear the same
      // class here, or the two "identical" views disagree on its code.
      this.state._typeOverrides = (s.light_type_overrides && typeof s.light_type_overrides === "object") ? s.light_type_overrides : {};
      // The presentation modes are set in the Mapping → Lights tab and read
      // here for the same reason the shapes are: this panel DISPLAYS the map
      // that tab BUILDS, so a mode that changed only one of them would mean
      // the two views no longer show the same house.
      // One reading of the look, shared with Traceback's Full house
      // activity (atlasLookFromSettings) so the two always match.
      const look = atlasLookFromSettings(s);
      this.state._showcase      = look.showcase;
      this.state._fitRooms      = look.fitRooms;
      this.state._hideUntouched = look.hideUntouched;
      this.state._hideDeviceCodes = look.hideDeviceCodes;
      this.state._isolux        = look.isolux;
      this.state._automorph     = look.automorph;
      this.state._automorphPct  = look.automorphRoomPct;
      this.state._automorphHardness = look.automorphHardness;
      this.state._automorphStyle = look.automorphStyle;
      this.state._automorphSubtlety = look.automorphSubtlety;
      this.state._showcaseTheme = look.showcaseTheme;
      // Quick-apply only (see onApplyPreset in the host below) — presets are
      // authored in Mapping -> Lights, this panel just switches between them.
      this.state._showcasePresets = Array.isArray(s.lights_showcase_presets) ? s.lights_showcase_presets : [];
      // Settings → UI Structure → "Show the Test emergency lighting button".
      // A failed settings fetch keeps the last answer.
      if (s.atlas_emergency_button !== undefined) this.state._emergButtonHidden = s.atlas_emergency_button === false;
      if (s.atlas_live_colours !== undefined) this.state._liveColours = s.atlas_live_colours === true;
      if (s.atlas_heatmap_enabled !== undefined) this.state._heatmapOn = s.atlas_heatmap_enabled === true;
      // Settings → Atlas → Audio: the classic layout's Audio, house-wide (_roomControlsOn). A failed fetch keeps the last answer.
      if (s.atlas_audio_enabled !== undefined) this.state._audioOn = s.atlas_audio_enabled === true;
      // Settings → Atlas → Shades and Thermostats: the same, for a room sheet's shades and its thermostats (_roomParts).
      if (s.atlas_shades_enabled !== undefined) this.state._shadesOn = s.atlas_shades_enabled === true;
      if (s.atlas_thermostats_enabled !== undefined) this.state._thermostatsOn = s.atlas_thermostats_enabled === true;
      // Devices → Door Openers' marked openers: never a room sheet's shades (_roomCtl openers).
      if (Array.isArray(s.door_opener_ids)) this.state._doorOpeners = s.door_opener_ids;
      // Settings → Atlas → Atlas — Mapped Light Control → Alert pulse, normally off.
      this.state._alertPulse = s.atlas_alert_pulse === true;
      // Outdoor weather (Settings → Atlas → Atlas — Mapped Light Control → Outdoor weather), field by field. A
      // failed fetch keeps the last answer; before any answer, no weather.
      if (s.atlas_weather_enabled !== undefined) {
        this.state._weather = {
          atlas_weather_enabled: s.atlas_weather_enabled,
          atlas_weather_rain_entity: s.atlas_weather_rain_entity,
          atlas_weather_condition_entity: s.atlas_weather_condition_entity,
          atlas_weather_warning_entity: s.atlas_weather_warning_entity,
          atlas_weather_strength: s.atlas_weather_strength,
          // When the rain sensor turned wet (rain_wet.py): one wet for hours is stuck.
          atlas_weather_rain_wet_since: s.atlas_weather_rain_wet_since,
        };
      }
      // The 3D house (Settings → Atlas → Atlas — Mapped Light Control → Live Aboard), normally
      // off. A failed fetch keeps the last answer; before any, no switch.
      if (s.atlas_3d_enabled !== undefined) {
        this.state._house3d = { atlas_3d_enabled: s.atlas_3d_enabled, atlas_3d_quality: s.atlas_3d_quality,
          fabric_bearing_deg: s.fabric_bearing_deg, atlas_3d_weather: s.atlas_3d_weather, atlas_3d_showcase: s.atlas_3d_showcase, atlas_3d_look: s.atlas_3d_look,
          atlas_3d_people: s.atlas_3d_people, presence_poll_interval_s: s.presence_poll_interval_s, light_shapes: s.light_shapes,
          atlas_3d_tags: s.atlas_3d_tags, atlas_3d_carries: s.atlas_3d_carries, atlas_3d_home_idle_s: s.atlas_3d_home_idle_s,
          atlas_3d_director_people: s.atlas_3d_director_people,
          // A linked robot vacuum is drawn on the map while Robot Vacuum Import is on (lights_map.js abLive).
          vacuum_import_enabled: s.vacuum_import_enabled,
          // The 3D house's rung (editions.js house3dTier).
          free_basics: s.free_basics,
          atlas_3d_director: s.atlas_3d_director };
      }
      this.state._wholeHousePresets = Array.isArray(s.whole_house_presets) ? s.whole_house_presets : [];
      // Room controls' matches (views/room_controls.js). A failed fetch keeps the last answer.
      if (s.room_audio_matches !== undefined) this.state._roomAudio = roomAudioOf(s, this.state._roomAudio);
      // Layout v2 (2026-09-21) is a house-wide trial toggle, set
      // from the builder only — this panel reflects it, same convention
      // as showcase/automorph above, but renders its OWN DISPLAY variant
      // (host.displayMode below): edge-to-edge map, a slim rail, no
      // onLayoutV2 handed to the host, so no toggle button shows here.
      this.state._atlasLayoutV2 = !!s.atlas_layout_v2;
      this.state._wall = { wall_screen_in: s.wall_screen_in, wall_distance_m: s.wall_distance_m, wall_text_arcmin: s.wall_text_arcmin,
                           wall_night_dim: s.wall_night_dim, wall_pixel_shift: s.wall_pixel_shift,
                           wall_floor_cycle_s: s.wall_floor_cycle_s, wall_fully: s.wall_fully };
      // Vacation Mode's own state — read here too now that the banner lives
      // in the shared Atlas card (both hosts), not panel.js's global chrome.
      this.state._vacationModeEnabled = !!s.vacation_mode_enabled;
      this.state._optimizeScale = !!s.optimize_for_scale;
      this.state._vacationModeResumed = !!s.vacation_mode_pattern_for;
      this.state._vacationSettings = s;
      this.state._vacationModeIntensity = Number.isFinite(Number(s.vacation_mode_intensity)) ? Number(s.vacation_mode_intensity) : 100;
      // {entity_id: epoch-s of its most recent "on"} — flood_latch.py's
      // event listener writes this server-side; ungated, same reasoning as
      // the tier read above (a flood alarm isn't a paid convenience).
      this.state._floodLatches = (s.flood_latches && typeof s.flood_latches === "object") ? s.flood_latches : {};
      // The same Zigbee device in ZHA and Zigbee2MQTT (zigbee_twins.py): which copy the map leaves out.
      this.state._zigbeeTwins = s.zigbee_twins || null;
      // The effective tier the backend computed (licence.py). Below `bright`
      // the shared pipeline draws the free map — see lights_map.js. A settings
      // fetch that failed keeps the tier it last knew rather than flickering
      // a Pro house down to the free drawing for one poll.
      if (s.tier !== undefined) this.state._tier = String(s.tier);
      // And the add-ons it may use (licence.addon_allowed), kept the same way.
      if (s.addons_licensed !== undefined) this.state._addons = Array.isArray(s.addons_licensed) ? s.addons_licensed : [];
      // And which add-ons are on sale (licence.addons_on_sale): a feature moving into one is gated from then (hostAddonGate).
      if (s.addons_on_sale !== undefined) this.state._addonsOnSale = Array.isArray(s.addons_on_sale) ? s.addons_on_sale : [];
      // Features moved down the ladder (licence.FREE_BASICS): sent only while on. With the tier, so a failed fetch keeps both.
      if (s.tier !== undefined) this.state._freeBasics = freeBasics(s);
      // Enhanced security: on, only an administrator changes the house's setup (placing a device among it).
      if (s.tier !== undefined) this.state._enhancedSecurity = s.enhanced_security !== false;
      // What the trial card reads: whether any key exists, and the tier (a
      // failed fetch keeps the last answer, same as the tier above); and
      // whether the usage report is on, so its offer counts only leave the
      // browser when it is (panel.js _telemetryEvent's rule).
      if (s.pro_has_key !== undefined) {
        this.state._trialSettings = { pro_has_key: s.pro_has_key, addon_key: s.addon_key, tier: s.tier,
          edition: s.edition, bright_reveal_presence: s.bright_reveal_presence,
          // The pitch names what Pro adds on top of the free basics (trial_offer.js trialPitch).
          free_basics: s.free_basics,
          telemetry_enabled: !!s.telemetry_enabled };
        this.state._telemetryOn = !!s.telemetry_enabled;
      }
      // Hidden-map ids are read only to stay consistent with the Mapping tab
      const savedIds = s.hidden_map_ids;
      if(Array.isArray(savedIds)){
        this.state._hiddenMapIds = new Set(savedIds);
      } else {
        try{ this.state._hiddenMapIds = new Set(JSON.parse(localStorage.getItem("padspan_hiddenMapIds")||"[]")); }
        catch(e){ this.state._hiddenMapIds = new Set(); }
      }
      // Restore hidden lights from backend (authoritative over localStorage).
      // An EMPTY array is a real value — "nothing hidden" — not a missing
      // one: unhiding the last light in the Mapping → Lights tab writes []
      // here, and skipping it would resurrect this device's stale
      // localStorage copy and hide a light the tab shows.
      if(Array.isArray(s.lights_hidden)){
        this.state._hidden = new Set(s.lights_hidden);
        try{ localStorage.setItem(LS_HIDDEN, JSON.stringify(s.lights_hidden)); }catch(_){}
      }
    }catch(e){}
  }

  // ── Emergency lighting test (emergency_test.py) ────────────────────────────
  // A manual test only: HA's own power-failure automations are untouched.
  // No command (an older backend) or no lights found: no button.
  async _loadEmergency(){
    this._emergTs = Date.now();
    // Sequence guard: every status request and every action takes a number;
    // an answer is kept only if nothing newer was sent since, and never while
    // an action runs — a poll that left before a tap must not paint the
    // pre-tap state over what the action returned.
    const seq = this._emergSeq = (this._emergSeq || 0) + 1;
    let r = null;
    try{ r = await this._ws({ type:"padspan_ha/emergency_status" }); }
    catch(_){ r = null; }
    if(seq !== this._emergSeq || this._emergBusy) return;
    this.state._emerg = r;
  }

  // An action's answer: always the newest state (and it outdates any status
  // request still on its way).
  _emergApply(r){
    this._emergSeq = (this._emergSeq || 0) + 1;
    this.state._emerg = r; this._emergTs = Date.now();
  }

  // queue: Force off. A tap while an action runs is never dropped silently:
  // it is told "Still switching…", and Force off runs right after the
  // running action (repeated taps collapse into one).
  async _emergencyCall(msg, done, queue=false){
    if(this._emergBusy){
      if(queue) this._emergQueued = { msg, done };
      this._toast(queue ? t("Still switching… Force off runs next.") : t("Still switching…"));
      return;
    }
    this._emergBusy = true;
    this._emergSeq = (this._emergSeq || 0) + 1;
    this._render();                                  // the busy state on the button
    try{
      const r = await this._ws(msg);
      this._emergApply(r);
      const name = {};
      for(const m of (r && r.members) || []) name[m.entity_id] = m.name || m.entity_id;
      const names = (ids)=>ids.map(e=>name[e]||e).join(", ");
      const res = (r && r.results) || [];
      const unreachable = res.filter(x=>x.skipped==="unavailable" || x.skipped==="missing").map(x=>x.entity_id);
      const failed = res.filter(x=>!x.ok && !x.skipped).map(x=>x.entity_id);
      const lines = [done(r, names)];
      if(unreachable.length) lines.push(t("Not reachable: {names}", { names: names(unreachable) }));
      if(failed.length) lines.push(t("Could not switch: {names}", { names: names(failed) }));
      if(lines.filter(Boolean).length) this._toast(lines.filter(Boolean).join("\n"), failed.length > 0);
    }catch(e){
      this._toast(t("Emergency lighting: {why}", { why: this._errorText(e) }), true);
    }finally{
      this._emergBusy = false;
      const next = this._emergQueued;
      this._emergQueued = null;
      this._render();
      if(next) this._emergencyCall(next.msg, next.done, true);
    }
  }

  // Start or end the test — the centre of the button and its label.
  _emergencyToggle(){
    const test = (this.state._emerg && this.state._emerg.test) || {};
    const left = [...(test.kept_on || []), ...(test.manual || [])];
    this._emergencyCall({ type:"padspan_ha/emergency_test", on: !test.active }, (r, names)=>{
      const real = ((r && r.results) || []).find(x => x && x.kept === "emergency");
      if(test.active && real) return t("Emergency lighting test ended. {names} ran during the test, so every emergency light was left on. Turn them off from the list (the ring) when you're ready.", { names: (real.by || []).join(", ") });
      if(test.active) return t("Emergency lighting test ended.") + (left.length ? "\n" + t("Left on or as set: {names}", { names: names(left) }) : "");
      const k = (r && r.test && r.test.kept_on) || [];
      return t("Emergency lighting test on.") + (k.length ? "\n" + t("Already on, will stay on: {names}", { names: names(k) }) : "");
    });
  }

  // One tap, except after a real emergency ran during the test (HA's own
  // power-failure automation): then a second tap within 3 s confirms.
  _emergencyForceOff(){
    const ran = (this.state._emerg && this.state._emerg.emergency_ran) || [];
    if(ran.length && !this._emergArmed()){
      this._emergArmUntil = Date.now() + 3000;
      this._toast(t("{names} ran during the test.\nTap again to turn off every emergency light", { names: ran.join(", ") }), true, 3000);
      clearTimeout(this._emergArmTimer);
      this._emergArmTimer = setTimeout(()=>{ this._emergArmUntil = 0; this._render(); }, 3000);
      this._render();
      return;
    }
    this._emergArmUntil = 0;
    clearTimeout(this._emergArmTimer);
    this._emergencyCall({ type:"padspan_ha/emergency_force_off" }, ()=>t("Emergency lights off."), true);
  }

  _emergArmed(){ return (this._emergArmUntil || 0) > Date.now(); }

  // The floating button: a red centre (start/end the test) inside a ring of
  // its own (the card of every emergency light), the notch on the ring
  // marking it as the list.
  //
  // The house's alarm is inside this button (the owner, 2026-11-24: "put it
  // in the emergency button on the top right of the screen inside the button
  // there"): the centre is the alarm's shield in its state's colour, and the
  // centre and the ring both open the button's card, the alarm on top. The
  // test then starts from the card, so a hand going for the alarm never
  // starts it. The button changes with what the house has (the owner,
  // 2026-11-24: "Have the button change if there are no emergency lights, or
  // if there is no alarm"): no alarm panel, the emergency lighting button
  // exactly as before; an alarm and no emergency lights, the alarm's own
  // button, a plain ring in its colour (no emergency stripes, no list notch);
  // both, the emergency ring with the alarm's shield as its centre.
  _emergencyOverlay(){
    const s = this.state._emerg;
    const alarm = this._alarmSummary();
    // Settings → UI Structure → "Show the Test emergency lighting button".
    // Hidden only while idle: a test running (started here or elsewhere)
    // always shows, so it can be seen and ended. The alarm is not the test:
    // it stays. The emergency lights are Alarm & security's (_alarmControls):
    // without it, only an alarm going off, and with none, no button; but a
    // test already running (it outlives a restart and a lapsed key) always
    // shows, so it can be ended or forced off (emergency_test.py allows both).
    const running = !!(s && s.test && s.test.active);
    const lights = (this._alarmControls() || running) && !!(s && s.available) && !(this.state._emergButtonHidden && !running);
    if(!lights && !alarm) return null;
    const active = lights && !!(s.test && s.test.active);
    const busy = lights && !!this._emergBusy;
    const notch = el("span",{class:"lv-emerg-notch"});
    notch.innerHTML = '<svg viewBox="0 0 8 8" width="8" height="8" stroke="currentColor" stroke-width="1" '
      + 'stroke-linecap="round" aria-hidden="true"><path d="M1.5 1.5h5M1.5 4h5M1.5 6.5h5"/></svg>';
    const alarmOnly = !lights;
    const ring = el("button",{
      class: "lv-emerg-ring" + (alarmOnly ? " lv-emerg-ring-alarm lv-emerg-ring-alarm-" + alarm.kind : ""),
      title: alarmOnly ? alarm.label : alarm ? t("Alarm and emergency lights") : t("Emergency lights — list and controls"),
      "aria-label": alarmOnly ? alarm.label : alarm ? t("Alarm and emergency lights") : t("Emergency lights: list and controls"),
      // The card is rebuilt every poll: keep the pulse's phase continuous.
      style: active ? `animation-delay:-${(Date.now() % 1600) / 1000}s` : null,
      onclick: ()=>this._openEmergencyCard(),
    }, alarmOnly ? [] : [notch]);
    let centre, labelText, labelIcon, labelGo;
    if(alarm){
      const shield = el("span",{class:"lv-emerg-icon"});
      shield.innerHTML = ALARM.SHIELD;
      centre = el("button",{
        class: "lv-emerg-btn lv-emerg-alarm lv-emerg-alarm-" + alarm.kind, title: alarm.title, "aria-label": alarm.label,
        "aria-busy": busy ? "true" : null,
        onclick: ()=>this._openEmergencyCard(),
      },[shield]);
    } else {
      const name = {};
      for(const m of s.members || []) name[m.entity_id] = m.name || m.entity_id;
      const kept = ((s.test && s.test.kept_on) || []).map(e=>name[e]||e).join(", ");
      const title = busy ? t("Switching the emergency lights…") : active
        ? t("Emergency lighting test on — tap to end") + (kept ? "\n" + t("Already on, will stay on: {names}", { names: kept }) : "")
        : t("Test emergency lighting");
      const icon = el("span",{class:"lv-emerg-icon"});
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" '
        + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18v-5a5 5 0 0 1 10 0v5"/>'
        + '<path d="M5 18h14v3H5z"/><path d="M12 2v2M4.9 5.4l1.4 1.4M19.1 5.4l-1.4 1.4M2 12h2M20 12h2"/></svg>';
      centre = el("button",{
        class: "lv-emerg-btn", title, "aria-label": title, "aria-pressed": active ? "true" : "false",
        "aria-busy": busy ? "true" : null,
        onclick: ()=>this._emergencyToggle(),
      },[icon]);
    }
    // The label: an icon alone on a narrow map (styles.css), so Force off
    // never slides under the rail. With an alarm and no test running it says
    // the alarm's state, and opens the card as the button does.
    const shown = active || busy;
    if(alarm && !shown){
      labelText = alarm.label;
      labelIcon = el("span",{class:"lv-emerg-label-ic", "aria-hidden":"true"});
      labelIcon.innerHTML = ALARM.SHIELD;
      labelGo = ()=>this._openEmergencyCard();
    } else {
      labelText = busy ? t("Switching…") : active ? t("Test on — tap to end") : t("Test emergency lighting");
      labelIcon = el("span",{class:"lv-emerg-label-ic", "aria-hidden":"true"});
      if(busy) labelIcon.textContent = "…";
      else labelIcon.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">'
        + '<rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';
      labelGo = ()=>this._emergencyToggle();
    }
    const kids = [
      el("div",{class:"lv-emerg-dial" + (active ? " on" : "")},[ring, centre]),
      el("button",{class:"lv-emerg-label" + (shown ? " on" : ""), tabindex: shown ? null : "-1",
        "aria-hidden": shown ? null : "true", "aria-label": labelText, title: labelText,
        onclick: labelGo},
        [labelIcon, el("span",{class:"lv-emerg-label-tx"}, labelText)]),
    ];
    const armed = this._emergArmed();
    if(active) kids.push(el("button",{
      class: "lv-emerg-force" + (armed ? " armed" : ""),
      title: armed ? t("Tap again to turn off every emergency light")
        : t("Turn off every emergency light, including the ones that were already on"),
      onclick: ()=>this._emergencyForceOff(),
    }, armed ? t("Tap again") : t("Force off")));
    return el("div",{class:"lv-emerg-anchor"},[el("div",{class:"lv-emerg" + (busy ? " busy" : ""),
      "aria-busy": busy ? "true" : null},kids)]);
  }

  // ── The house's alarm inside the emergency button (views/alarm_panel.js) ──
  // Its state and Arm/Disarm with Alarm & security: PadSpan Pro or the add-on
  // (and Bright Pro, which always had them). Without it only an alarm going
  // off, said: a safety alert is free. Read from this page's hass at every
  // draw (the 5 s poll), never stored. The same gate gives the door, garage
  // and gate card (barrierHit) and the emergency lights (_emergencyOverlay).
  _alarmControls(){ return String(this.state._tier||"").toLowerCase()==="bright" || this._addon("alarm"); }
  _alarmSummary(){
    if(!ALARM) return null;
    const states = (this._hass && this._hass.states) || {};
    const controls = this._alarmControls();
    const sum = ALARM.alarmSummary({ panels: ALARM.alarmPanels(states), states, controls });
    if(sum && controls && !this._alarmShownSaid){ this._alarmShownSaid = true; this._alarmCount("shown"); }
    return sum;
  }
  // The opt-in report: alarm_button:shown / arm / disarm / refused, counts
  // only (telemetry.py ALARM_BUTTON_EVENTS), never a code or a name.
  _alarmCount(word){
    if(!this.state._telemetryOn || !this._hass) return;
    Promise.resolve(this._ws({ type:"padspan_ha/telemetry_event", event:"alarm_button:" + word })).catch(()=>{});
  }

  // The card behind the button: the house's alarm on top (views/alarm_panel.js
  // alarmSection), then every emergency light, its state and tags, a
  // switch each, and a light's own Atlas controls. On document.body like the
  // Atlas sheets (so styled inline). Refilled on a render only when what it
  // shows changed, and never while a finger is down on it — a rebuild under
  // a tap loses the tap.
  _openEmergencyCard(){
    if(this._emergCard) return;
    // A bottom sheet on a phone, a centred card on a desktop — as the Atlas sheets.
    const desktop = typeof window !== "undefined" && window.innerWidth > 768;
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(3,8,5,.58);backdrop-filter:blur(6px);"
      + "-webkit-backdrop-filter:blur(6px);display:flex;justify-content:center;"
      + `align-items:${desktop ? "center" : "flex-end"}`;
    const sheet = el("div",{style:"width:100%;max-width:520px;max-height:78vh;overflow:auto;padding:14px 16px 18px;"
      + "box-sizing:border-box;background:linear-gradient(180deg,#1f1010,#140b0b);border:1px solid rgba(220,38,38,.45);"
      + `border-radius:${desktop ? "16px" : "18px 18px 0 0"};color:#e2e8f0;font-family:Inter,system-ui,sans-serif;`
      + "box-shadow:0 -12px 50px rgba(0,0,0,.6)"});
    overlay.appendChild(sheet);
    // The house's alarm, on top. Alarm & security arms and disarms it; without it one sees
    // it only while it goes off.
    const alarm = ALARM ? ALARM.alarmSection({
      el, controls: this._alarmControls(),
      states: ()=>(this._hass && this._hass.states) || {},
      call: (service, data)=>this._hass.callService(ALARM.DOMAIN, service, data),
      ask: confirmAsk,
      toast: (m, e)=>this._toast(m, e),
      errorText: (e)=>this._errorText(e),
      count: (w)=>this._alarmCount(w),
    }) : null;
    // Escape does what ✕ does, Tab stays in the card, the focus goes back (views/dialog_keys.js).
    let release = ()=>{};
    const close = ()=>{ overlay.remove(); this._emergCard = null; if(alarm) alarm.close(); release(); };
    overlay.addEventListener("click", e=>{ if(e.target === overlay) close(); });
    let down = false, shown = null;
    overlay.addEventListener("pointerdown", ()=>{ down = true; });
    for(const t of ["pointerup", "pointercancel", "pointerleave"]) overlay.addEventListener(t, ()=>{ down = false; });
    // What the card shows: the status (not the last action's results), each
    // member's live state, the busy and "tap again" states.
    const shows = ()=>{
      const s = this.state._emerg;
      const states = (this._hass && this._hass.states) || {};
      return JSON.stringify([s ? { ...s, results: undefined } : null,
        ((s && s.members) || []).map(m => states[m.entity_id] ? states[m.entity_id].state : m.state),
        !!this._emergBusy, this._emergArmed(), alarm ? alarm.shows() : null]);
    };
    const act = "font-size:12px;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;min-height:34px;"
      + "background:rgba(255,255,255,.03);border:1px solid rgba(252,165,165,.3);color:rgba(254,226,226,.85)";
    const chip = (text, style)=>el("span",{style:"display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;"
      + "font-size:10px;font-weight:700;letter-spacing:.04em;white-space:nowrap;" + style}, text);
    const fill = ()=>{
      const s = this.state._emerg;
      // As the button (_emergencyOverlay): Alarm & security's, or a test still running.
      const lights = (this._alarmControls() || !!(s && s.test && s.test.active)) && !!(s && s.available);
      const withAlarm = !!alarm && !alarm.empty();
      if(!lights && !withAlarm){ close(); return; }
      shown = shows();
      if(withAlarm){
        while(sheet.firstChild) sheet.removeChild(sheet.firstChild);
        sheet.appendChild(el("div",{style:"display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px"},[
          el("div",{style:"font-weight:800;font-size:16px;letter-spacing:-.01em"},t("Emergency")),
          el("button",{style:act, title:t("Close"), onclick:close},"✕"),
        ]));
        alarm.fill();
        sheet.appendChild(alarm.node);
        if(!lights) return;
      }
      const test = s.test || {};
      const active = !!test.active;
      const busy = !!this._emergBusy;
      const armed = this._emergArmed();
      const states = (this._hass && this._hass.states) || {};
      const groupNames = (s.groups || []).map(g=>(states[g] && states[g].attributes && states[g].attributes.friendly_name) || g);
      const from = s.source === "group" ? t("From {groups}", { groups: groupNames.join(" " + t("and") + " ") })
        : s.source === "settings" ? t("From the emergency lights setting")
        : t("WLED lights named Emergency");
      // Under the alarm, the lights' own heading (the ✕ is on the card's top line).
      if(withAlarm) sheet.appendChild(el("div",{style:"margin-bottom:10px"},[
        el("div",{style:"font-weight:800;font-size:14px;letter-spacing:-.01em"},t("Emergency lights")),
        el("div",{style:"font-size:12px;color:rgba(226,240,232,.5);margin-top:2px"}, from),
      ]));
      else {
        while(sheet.firstChild) sheet.removeChild(sheet.firstChild);
        sheet.appendChild(el("div",{style:"display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px"},[
          el("div",{},[
            el("div",{style:"font-weight:800;font-size:16px;letter-spacing:-.01em"},t("Emergency lights")),
            el("div",{style:"font-size:12px;color:rgba(226,240,232,.5);margin-top:2px"}, from),
          ]),
          el("button",{style:act, title:t("Close"), onclick:close},"✕"),
        ]));
      }
      const dim = busy ? ";opacity:.55;cursor:progress" : "";
      sheet.appendChild(el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px",
        "aria-busy": busy ? "true" : null},[
        el("button",{style: act + (active ? ";background:#7f1d1d;border-color:#dc2626;color:#fff" : "") + dim,
          onclick:()=>this._emergencyToggle()}, active ? t("End test") : t("Start test")),
        ...(active ? [el("button",{style: act + (armed ? ";background:#dc2626;border-color:#fecaca;color:#fff" : "") + dim,
          title: armed ? t("Tap again to turn off every emergency light")
            : t("Turn off every emergency light, including the ones that were already on"),
          onclick:()=>this._emergencyForceOff()}, armed ? t("Tap again") : t("Force off"))] : []),
        ...(busy ? [el("span",{style:"font-size:12px;color:rgba(254,226,226,.75)"},t("Switching…"))] : []),
      ]));
      // Without Alarm & security (a test that outlived the key) the list says each light's state; End test and
      // Force off are its controls, a light's own switch is the add-on's (emergency_test.py refuses it).
      const own = this._alarmControls();
      for(const m of s.members || []){
        const st = states[m.entity_id] ? states[m.entity_id].state : m.state;
        const on = st === "on";
        const dead = st === "unavailable" || st === "missing" || st === undefined;
        const tags = [];
        if(active && (test.kept_on || []).includes(m.entity_id)) tags.push(chip(t("was on"), "color:#fde68a;border:1px solid rgba(251,191,36,.45)"));
        if(active && (test.manual || []).includes(m.entity_id)) tags.push(chip(t("set here"), "color:#bfdbfe;border:1px solid rgba(96,165,250,.45)"));
        const row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(252,165,165,.1)"},[
          el("span",{style:"flex:1;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis"}, m.name || m.entity_id),
          ...tags,
          chip(dead ? t("Unavailable") : on ? t("On") : t("Off"),
            dead ? "color:rgba(226,240,232,.4);border:1px dashed rgba(226,240,232,.25)"
              : on ? "color:#111827;background:#fbbf24;border:1px solid #fbbf24"
              : "color:rgba(226,240,232,.55);border:1px solid rgba(226,240,232,.2)"),
          // Fixed widths, and a blank where a row has no "⋯", so the state
          // chips and buttons line up down the list.
          ...(own ? [el("button",{style: act + ";min-width:82px" + (dead ? ";opacity:.4;cursor:default" : dim),
            disabled: dead ? "" : null,
            onclick:()=>this._emergencyCall({ type:"padspan_ha/emergency_member", entity_id:m.entity_id, on:!on }, ()=>null)},
            on ? t("Turn off") : t("Turn on")),
          ...(m.entity_id.startsWith("light.") && !dead ? [el("button",{style: act + ";padding:6px 0;width:38px", title:t("Brightness, colour and effects"),
            onclick:()=>{
              // Adjusting a light during a test counts as setting it by hand.
              if(active) this._ws({ type:"padspan_ha/emergency_member", entity_id:m.entity_id })
                .then(r=>{ this._emergApply(r); }).catch(()=>{});
              close();
              this._openWledDetail(m.entity_id);
            }},"⋯")] : [el("span",{style:"width:38px;flex:none", "aria-hidden":"true"})])] : []),
        ]);
        sheet.appendChild(row);
      }
      sheet.appendChild(el("div",{style:"font-size:11px;color:rgba(226,240,232,.5);line-height:1.5;margin-top:10px"},
        active ? t("When the test ends, lights marked “was on” stay on and lights marked “set here” stay as you set them. Force off turns every one off.")
          : t("Start test turns every emergency light on. Lights already on stay on when it ends.")));
    };
    const refresh = ()=>{ if(!down && shows() !== shown) fill(); };
    this._emergCard = { fill, close, refresh, sheet, overlay };
    fill();
    document.body.appendChild(overlay);
    if(this._emergCard && KEYS) release = KEYS.holdKeys(sheet, { close, modal: true });
  }

  /** This screen is a wall that asked for its floors arranged for its shape (?arrange=1 on its link), not moved by
   *  hand here. Every other wall stacks its floors with the saved Spacing and L/R, as every screen does. */
  _wallArranges(){ try { return new URLSearchParams(location.search).get("arrange") === "1"; } catch(_) { return false; } }
  _wallFitted(){ return this.hasAttribute("data-wall") && this._wallArranges() && !this._view.fitByHand; }

  async _saveSettings(){
    try{
      // Never bundle data_mode: the backend leaves it untouched when the
      // message omits it, and echoing "live" here would make Save view flip
      // a sample-mode install to live as a hidden side effect (same reason
      // panel.js's settingsSet omits it).
      // A wall's own arrangement is never saved as everyone's spacing.
      const gaps = this._wallFitted() ? {} : { overview_iso_floor_gap: this._view.floorGap, overview_iso_horiz_gap: this._view.horizGap };
      await this._ws({
        type:                    "padspan_ha/settings_set",
        ...gaps,
        overview_iso_focus:      this._view.focusIdx,
        overview_iso_zoom:       this._view.zoom,
      });
    }catch(e){ throw e; }
  }

  async _toggle(eid){
    return toggleEntity(this._hass, eid, {
      render: () => this._render(),
      toast: (m, e) => this._toast(m, e),
      shake: (eid) => this._shake(eid),
    });
  }

  // The revert shake: a short wobble on the marker whose tap failed.
  _shake(eid){
    requestAnimationFrame(()=>{
      const g=this.shadowRoot && this.shadowRoot.querySelector(`.lhex[data-eid="${CSS.escape(String(eid))}"]`);
      if(!g) return;
      g.classList.add("lv-shake");
      setTimeout(()=>g.classList.remove("lv-shake"), 500);
    });
  }

  // Aggregate actions: every light (and, separately, every fan) in a room
  // or on a floor. Fans are never swept up by "all lights off" — the sheet
  // offers them their own button, so the word "all" is never ambiguous.
  async _setMany(eids, turnOn){
    await setManyStates(this._hass, eids, turnOn, {toast:(m,e)=>this._toast(m,e), rerender:()=>this._render()});
  }

  // The control card (shared, views/lights_map.js): capability-driven —
  // brightness / colour / effects for a light, speed / preset / oscillate /
  // direction for a fan. The admin's pencil deep-links to the builder.
  _openWledDetail(eid){
    openControlCard(this._hass, eid, {
      toast:(m,e)=>this._toast(m,e),
      rerender:()=>this._render(),
      // Not in Basic: Mapping → Atlas builder is an expert screen,
      // and Basic's Mapping would put the link back on Library.
      onEdit: this._isAdmin() && !this._basicMode() ? (e)=>this._gotoBuilder(e) : null,
      // A wall (?kiosk=1): no Details, nothing on it leaves the page.
      kiosk: this._kiosk(),
      ...controlApiFor(this._regStore?.reg, eid, { tier: this.state._tier, addons: this.state._addons, isAdmin: this._isAdmin() }),
    });
  }

  _kiosk(){ try { return new URLSearchParams(location.search).get("kiosk")==="1"; } catch (_) { return false; } }

  _isAdmin(){ return !!(this._hass && this._hass.user && this._hass.user.is_admin); }
  // Whether this install may use add-on `name` (views/editions.js addonAllowed): Pro includes every add-on.
  _addon(name){ return addonAllowed({ tier: this.state._tier, addons_licensed: this.state._addons }, name); }
  // Whether this install has Audio (views/room_controls.js: the ⋯ list's "Audio" line, its "Set up ›", a room sheet's
  // Audio part, Settings → Atlas → Audio): the ONE place it is decided. PadSpan Pro or the Audio add-on.
  _audioAllowed(){ return this._addon("audio"); }
  // Whether this screen keeps its own ⋯ list (Show on this screen): Pro's display layout, or a wall (the layout a wall
  // below Pro is drawn with too: the host's layoutV2). The classic layout has no ⋯ list: Settings → Atlas switches.
  _screenLines(){ return (String(this.state._tier||"").toLowerCase()==="pro" && !!this.state._atlasLayoutV2) || this.hasAttribute("data-wall"); }
  // Audio on this screen: the ⋯ list's "Audio" (key room_controls), ticked per screen, where the screen has the list
  // (_screenLines: a wall's too, as its map's speakers follow, lights_map.js roomControlsOn); else Settings → Atlas →
  // Audio (atlas_audio_enabled) for the whole house.
  _roomControlsOn(){
    if(!ROOMCTL || !this._audioAllowed()) return false;
    return this._screenLines() ? screenShowLine("atlas","room_controls")===true : this.state._audioOn === true;
  }
  // Which parts of a room's sheet are on for this screen (room_controls.js sheet's parts; the owner, 2026-11-26: "Shades
  // should go with doors and Windows", "Thermostats in climate and air quality"): Audio as ever; Shades, everyone's;
  // Thermostats, the Climate map add-on's (Pro includes it). On the display layout (Pro's, or a wall's: the layout that
  // has the ⋯ list) each is its own ⋯ line, off unless ticked; on the classic layout, Settings → Atlas → Shades and
  // Thermostats, off unless turned on.
  _roomParts(){
    const lines = this._screenLines();
    // Shades and Thermostats were Audio's until 2026-11-26, and a wall below Pro's display layout went by the Settings
    // switches (Audio's among them) until then: what a screen with the ⋯ list showed in a room's card, it keeps, its
    // new lines ticked once (carryShowLine: never again, so one unticked stays so). Read once the settings are in.
    if (lines && !this._carried && this.state._audioOn !== undefined) {
      this._carried = true;
      const ticked = screenShowLine("atlas", "room_controls") === true;
      const wasSwitches = !(String(this.state._tier||"").toLowerCase()==="pro" && !!this.state._atlasLayoutV2);
      const had = (classic) => ticked || (wasSwitches && this.state._audioOn === true && classic === true);
      if (wasSwitches) carryShowLine("atlas", "room_controls", this._audioAllowed() && this.state._audioOn === true);
      carryShowLine("atlas", "room_shades", had(this.state._shadesOn));
      carryShowLine("atlas", "room_climate", this._addon("climate") && had(this.state._thermostatsOn));
    }
    const on = (key, classic) => !!ROOMCTL && (lines ? screenShowLine("atlas", key)===true : classic === true);
    return { audio: this._roomControlsOn(), shades: on("room_shades", this.state._shadesOn),
             climate: this._addon("climate") && on("room_climate", this.state._thermostatsOn) };
  }
  // The covers that open a door or a gate (Alarm & security's), never a room sheet's shades: Devices → Door Openers'
  // marked ones, a wall's linked opener, and a cover a wall follows when nothing says it is a blind or a shutter (no
  // device class, and a door's, a gate's or a garage's name). A window's shutter or blind stays a shade.
  _doorOpeners(){
    const out = new Set((this.state._doorOpeners || []).filter(e => typeof e === "string"));
    const doorish = /\b(door|gate|garage)\b/i, states = (this._hass && this._hass.states) || {};
    for (const b of (this.state.model && this.state.model.rf_barriers_m) || []) {
      if (b && typeof b.linked_opener_entity_id === "string") out.add(b.linked_opener_entity_id);
      const e = b && b.linked_entity_id;
      if (typeof e !== "string" || !e.startsWith("cover.")) continue;
      const a = (states[e] && states[e].attributes) || {};
      if (!a.device_class && doorish.test(`${b.name || ""} ${a.friendly_name || ""} ${e}`.replace(/_/g, " "))) out.add(e);
    }
    return out;
  }
  // This page's room controls (views/room_controls.js), made once: functions only, read when used.
  _roomCtl(){
    if(!ROOMCTL) return null;
    if(!this._rc) this._rc = ROOMCTL.createRoomControls({
      hass: ()=>this._hass,
      model: ()=>this.state.model,
      settings: ()=>this.state._roomAudio || {},
      admin: ()=>this._isAdmin(),
      save: async (patch)=>{
        const r = await this._ws({ type:"padspan_ha/settings_set", ...patch });
        const st = (r && r.settings) || patch;
        this.state._roomAudio = roomAudioOf(st, this.state._roomAudio);
        return true;
      },
      toast: (m,e)=>this._toast(m,e),
      errorText: (e)=>this._errorText(e),
      // The covers that open a door or a gate, never a room sheet's shades: a wall's opener on the map (its own link a
      // cover, or its linked opener) and Devices → Door Openers' marked ones.
      openers: ()=>this._doorOpeners(),
      // The opt-in report's room_controls:<word> (telemetry.py ROOM_CONTROLS_EVENTS), only while it is on.
      count: (word)=>{
        if(!this.state._telemetryOn || !this._hass) return;
        Promise.resolve(this._ws({ type:"padspan_ha/telemetry_event", event:"room_controls:" + word })).catch(()=>{});
      },
      redraw: ()=>this._render(),
    });
    return this._rc;
  }
  // The PadSpan panel's Basic / Advanced choice, kept in this browser (panel.js).
  _basicMode(){ try { return localStorage.getItem("padspan_complexity") === "basic"; } catch (_) { return false; } }
  // Deep-link into the builder: the panel reads ?view= (existing), ?tab= and
  // ?light= (panel.js) and lands on Mapping → Lights with the light selected.
  _gotoBuilder(eid){
    const q=new URLSearchParams({view:"maps", tab:"lights"});
    if(eid) q.set("light", eid);
    try{ window.location.assign(`/padspan-ha?${q.toString()}`); }catch(_){}
  }

  // The api the shared use surface and sheets act through — the sidebar's
  // toggle (optimistic + shake), its control card, its aggregate action.
  _useApi(lightsByEid, lights){
    const controlsFor=hasControlCard;
    const api={
      hass:this._hass, lightsByEid, lights, controlsFor,
      // A wall (?kiosk=1): cards opened from the map (the robot's) leave nothing to navigate away to.
      kiosk:this._kiosk(),
      // Whether this screen shows people (Show people, and its ⋯ People line): the room sheet names no one otherwise.
      peopleShown: peopleShownOn("atlas", this.state._house3d, this.state._tier),
      // Room controls in the room sheet: Audio, Shades and Thermostats, each only while it is on for this screen
      // (_roomParts); roomParts says which.
      ...(()=>{ const parts = this._roomParts();
        return { roomControls: parts.audio || parts.shades || parts.climate ? this._roomCtl() : null, roomParts: parts }; })(),
      toggle:(eid)=>this._toggle(eid),
      openControls:(eid)=>this._openWledDetail(eid),
      openActivity:(eid)=>openActivityCalendar(this._hass, eid),
      setMany:(eids,on)=>this._setMany(eids,on),
      toast:(m,e)=>this._toast(m,e),
      rerender:()=>this._render(),
      // Barrier card's paired-lock lookup (computeDoorLockPairs) — same
      // registry fetch as everything else in _regStore, no extra round trip.
      doorLockMap: this._regStore?.reg?.doorLockMap || {},
      doorInvertByEid: doorInvertOf(this.state.model),
      floodLatches: this.state._floodLatches || {},
      onFloodReset: (eid)=>{
        this._ws({ type: "padspan_ha/flood_reset", entity_id: eid })
          .then(()=>this._render())
          .catch((e)=>this._toast(t("Could not reset: {why}", { why: this._errorText(e) }), true));
      },
    };
    // The room sheet stays live: _buildUI hands it each newer api and lights.
    api.openRoom=(room, onlyEids)=>{ this._roomSheet=openRoomSheet(api, lights, room, onlyEids); };
    api.openFloor=(z)=>openFloorSheet(api, lights, this.state.model, z);
    api.openLights=(eids)=>openLightsSheet(api, lights, eids);
    // Place a room's devices in one tap (the room sheet's button): only while placement has moved
    // down the ladder, where this user may place devices, and never on a wall.
    if(this._mayPlaceRoom()){
      api.unplacedIn=(room)=>this._unplacedIn(room, lights).length;
      api.placeRoom=(room)=>this._placeRoom(room, lights);
    }
    return api;
  }

  _mayPlaceRoom(){
    const fb=!!this.state._freeBasics;
    return fb && tierAtLeast(this.state._tier, placementTier(fb)) && !this._kiosk()
      && (this._isAdmin() || this.state._enhancedSecurity === false);
  }
  // A room's devices with no placement, not hidden and not a door or window, while the room has an outline to place them in.
  _unplacedIn(room, lights){
    const geo=(this.state.model?.room_geometry_m||{})[room];
    if(!geo || geo.type!=="poly" || !Array.isArray(geo.points_m)) return [];
    const placed=this.state.model?.light_positions_m||{}, hidden=this.state._hidden;
    return (lights||[]).filter(l=>l.area_name===room && !l.isDoor && !placed[l.entity_id] && !(hidden && hidden.has(l.entity_id)));
  }
  async _placeRoom(room, lights){
    const geo=(this.state.model?.room_geometry_m||{})[room];
    const at=placeRoomDevices(geo && geo.points_m, this._unplacedIn(room, lights));
    const all=Object.keys(at), fid=geo && geo.floor_id ? String(geo.floor_id) : null;
    if(!all.length) return;
    let n=0;
    try{
      for(const eid of all){
        await this._ws({ type:"padspan_ha/fabric_light_position_set", entity_id:eid, x_m:at[eid][0], y_m:at[eid][1], ...(fid ? { floor_id:fid } : {}) });
        n++;
      }
      this._toast(t("Placed {n} in {room}.", { n, room }));
    }catch(e){
      this._toast(t("Placed {n} of {of} in {room}: {why}", { n, of: all.length, room, why: this._errorText(e) }), true);
    }
    await this._loadModel();
    this._render();
  }

  _render(){
    if(!this.shadowRoot) return;
    const $c=this.shadowRoot.querySelector("#content");
    if(!$c) return;
    // The lights' index and the map card stay on screen from one update to
    // the next (lights_map.js buildLightsTable, host.keepTable, and
    // buildLightsMapCard, host.keepCard): each is laid out again only where
    // something in it changed. Everything else comes out first and is built
    // again, as ever.
    const kept=[this._tableKeep && this._tableKeep.root, this._cardKeep && this._cardKeep.card].filter(Boolean);
    // What is drawn again replaces the control that had the focus (a light
    // on the map, a row): the focus goes on its replacement, the same control
    // by its id or data key (views/dialog_keys.js), not to the page.
    const focused=KEYS ? KEYS.deepActive() : null;
    const back=focused && $c.contains(focused) ? KEYS.remember(focused) : null;
    let root=$c.firstChild;
    if(root && kept.some(k=>k.parentNode===root) && root===$c.lastChild){
      for(const n of [...root.childNodes]) if(!kept.includes(n)) root.removeChild(n);
    }else{
      while($c.firstChild) $c.removeChild($c.firstChild);
      root=null;
    }
    const parts=this._buildUI();
    if(!root){ root=el("div",{}); $c.appendChild(root); }
    layChildren(root, parts);
    if(back && !KEYS.deepActive()){ back.root=$c; KEYS.refocus(back); }
    if(this._emergCard) this._emergCard.refresh();
  }

  _tipText(){
    const off = String(this.state._tier||"").toLowerCase()==="pro" && !!this.state._atlasLayoutV2 && screenShowLine("atlas","light_taps")===false;
    // Device codes hidden (Mapping \u2192 Atlas builder): no code to tap. The
    // read-only tiles are named while one is on the map (_tilesShown, _buildUI).
    const codes = !this.state._hideDeviceCodes;
    return (off ? t("A tap doesn't switch a light on this screen") : t("Tap a light to switch it"))
        +" \u00b7 "+(codes ? (off ? t("tap its code or hold it for controls") : t("tap its code or hold for controls")) : t("hold it for controls"))
        +" \u00b7 "+t("tap a room name for the whole room")
        +(this._tilesShown === false ? "" : " \u00b7 "+t("motion, temperature and air-quality tiles are read-only"));
  }

  _buildUI(){
    this._wallOn();
    const parts=[];   // the page, top to bottom (_render lays them)

    // ── Header ────────────────────────────────────────────────────────────────
    // The lv- vocabulary from styles.css (loaded in this shadow root), so the
    // sidebar and the Mapping tab wear the same face.
    parts.push(el("div",{class:"lv-hero"},[
      el("div",{class:"lv-hero-title"},t("Atlas")),
      el("span",{class:"lv-ver"},`v${APP_VERSION}`),
      // The tip follows this screen's ⋯ "Tap a light to switch it" where the flat map honours it (Pro's layout, as
      // host.layoutV2 below; review 2026-11-11, C10): unticked, a tap switches nothing here.
      (this._tipEl = el("span",{class:"lv-hint"},this._tipText())),
      // Admin only: the pencil to the builder. Same map, the other tool.
      // Not in Basic, as a light's ✎ (Basic's Mapping would land on Library).
      el("span",{style:"margin-left:auto"}),
      ...(this._isAdmin() && !this._basicMode() ? [el("button",{class:"lv-act",title:t("Open Mapping \u2192 Atlas builder"),
        onclick:()=>this._gotoBuilder(null)},t("\u270e Edit map"))] : []),
      // Home Assistant's sidebar, hidden or shown (ha_sidebar.js): with it
      // hidden, this is the way back from the Atlas. Not on a phone, where
      // the sidebar is a drawer anyway (styles.css #haSide).
      ...(HA_SIDEBAR ? [this._haBtn = el("button",{class:"lv-act",id:"haSide","aria-pressed":String(HA_SIDEBAR.haHidden(this._hass)),
        title:t("Hide or show Home Assistant's sidebar, on this browser only"),onclick:()=>{
          const word = HA_SIDEBAR.toggleHaSidebar(this, this._hass);
          if(this.state._telemetryOn && this._hass) Promise.resolve(this._ws({ type:"padspan_ha/telemetry_event", event:word })).catch(()=>{});
        }}, HA_SIDEBAR.haLabel(this._hass))] : []),
      el("button",{class:"lv-act",onclick:()=>{
        this._regStore.reg=null; this._boot().then(()=>this._render());
      }},t("\u21bb Refresh")),
    ]));
    // While the one-time tip below is up it says all of this and more: the
    // header's line waits (hidden, still kept in step) until "Got it".
    this._tipEl.hidden = !this.state._coachSeen;
    // One-time coach mark. Dismissed once per browser; never again.
    if(!this.state._coachSeen){
      parts.push(el("div",{class:"lv-coach"},[
        el("span",{},"\u{1F4A1} " + t("Tap a light to switch it. Tap its code, or press and hold, for brightness, colour, effects and fan speed. Hold a dimmable light and slide up or down to dim it. Tap a room name for everything in the room. Motion, temperature and air-quality tiles are read-only — they just show what's happening.")),
        el("button",{class:"lv-act",onclick:()=>{
          this.state._coachSeen=true;
          try{ localStorage.setItem(LS_COACH,"1"); }catch(_){}
          this._render();
        }},t("Got it")),
      ]));
    }

    // ── Shared data pipeline — identical to the Mapping → Lights tab ─────────
    // Room assignment needs the entity/device registry (a multi-MB dump);
    // on/off state does not. Render immediately from the cached copy — the
    // shared loader refreshes in the background and re-renders when it lands.
    const reg = this.state._modelLoaded
      ? ensureLightsRegistry(this._regStore, this._hass, this.state.model.areas, ()=>this._render())
      : { areaMap:{}, platformMap:{}, loading:true };
    const lightsLoading = reg.loading;
    // Which WLED lights PadSpan runs (exact look): taps, the room sheet and
    // Whole House Presets route them through padspan_ha/wled_power.
    ensureExactDevices(this._hass, ()=>this._render());
    const linkedNow = new Set((this.state.model?.rf_barriers_m || []).map(b => b.linked_entity_id).filter(Boolean));
    const placedNow = this.state.model?.light_positions_m || {};
    const gathered = gatherLights(this._hass?.states||{}, reg.areaMap, this.state._shapeOverrides, { tier: this.state._tier, addons: this.state._addons }, reg.platformMap, this.state._typeOverrides, reg.pairMap, reg.manufacturerMap, undefined, false, this.state._motionReconnects,
      linkedNow);
    // A Zigbee device's duplicate copy stays off the map unless it is placed or linked (lights_map.js).
    const { lights, twins: zigbeeTwins } = withoutZigbeeDuplicates(gathered, { zigbee_twins: this.state._zigbeeTwins }, (eid) => !!placedNow[eid] || linkedNow.has(eid));

    if(!lights.length){
      parts.push(el("div",{class:"muted",style:"padding:8px"},t("No light entities found.")));
      return parts;
    }
    const lightsByEid={};
    for(const l of lights) lightsByEid[l.entity_id]=l;
    // An open room sheet shows the house as it is now, not as it was when it opened.
    if(this._roomSheet && !this._roomSheet.update(this._useApi(lightsByEid, lights), lights)) this._roomSheet=null;

    // Group by room (hidden excluded from map)
    const hidden=this.state._hidden;
    // A read-only tile (light_codes.js: a fixed glyph with no action) on the map: the tip names them (_tipText).
    this._tilesShown = lights.some(l => hasFixedGlyph(l) && !isControllable(l) && !hidden.has(l.entity_id));
    if(this._tipEl) this._tipEl.textContent = this._tipText();
    const byRoom={};
    for(const l of lights){
      if(l.area_name && !hidden.has(l.entity_id))
        (byRoom[l.area_name]=byRoom[l.area_name]||[]).push(l);
    }

    // ── The shared map card — identical map to the Mapping → Lights tab ──────
    // The same empty list every render: the map's patch keys on it (lights_map.js drawStageSvg).
    const floors=this.state.model.floors||NO_FLOORS;
    // Light placement's tier (Bright or Pro): the trial card below is offered without it.
    const paid=["bright","pro"].includes(String(this.state._tier||"").toLowerCase());
    // A wall (?kiosk=1): nothing on it may lead off this page (the ⋯ list's
    // links, the scene row's + New scene and ✎); what is set up elsewhere
    // says where, from another screen.
    let kiosk=false;
    try{ kiosk=new URLSearchParams(location.search).get("kiosk")==="1"; }catch(_){}

    const host={
      el,
      floors,
      model: this.state.model,
      tier: this.state._tier,
      // The add-ons this install may use (lights_map.js hostAddon): Pro has them all.
      addons: this.state._addons || [],
      addonsOnSale: this.state._addonsOnSale || [],
      // Placement and the 3D house's rungs (editions.js), read by lightsHostForTier.
      freeBasics: !!this.state._freeBasics,
      // Door/window/lock click-to-control (2026-09-22) — Alarm & security
      // (_alarmControls: Bright, Pro or the add-on), as maps.js's own barrierHit.
      barrierHit: this._alarmControls(),
      byRoom,
      hiddenEids: hidden,
      // This screen IS the house map (2026-09-21: "anything to the
      // sides is a distraction from the purpose of the screen") — v2's
      // display variant: edge-to-edge map, a slim icon rail, every bar a
      // drawer over the map. No onLayoutV2: the toggle lives in the
      // builder only, this panel just reflects what it's set to.
      // Gated to Pro specifically (2026-09-23) — same split as the
      // builder's own proTier, not the bright-or-pro `paid` above.
      // A wall below Pro (the plain wall mode, wallTier) is drawn by this layout too.
      layoutV2: (String(this.state._tier||"").toLowerCase()==="pro" && !!this.state._atlasLayoutV2) || this.hasAttribute("data-wall"),
      displayMode: true,
      // Audio (views/room_controls.js), where this install has it: offered in the ⋯ list (with its Set up ›), drawn
      // only while ticked there; on the classic layout, drawn while Settings → Atlas → Audio is on (audioOn).
      roomControls: this._audioAllowed() ? this._roomCtl() : null,
      audioOn: this.state._audioOn === true,
      // The ⋯ list's lines for a room sheet's other parts (_roomParts): Shades for everyone, Thermostats with the
      // Climate map add-on.
      roomLines: ROOMCTL ? ["room_shades", ...(this._addon("climate") ? ["room_climate"] : [])] : [],
      // Wall mode (?kiosk=1, _wallOn): the whole house fits the screen.
      wall: this.hasAttribute("data-wall"),
      // The wall's own shape, as it is hung (a turned wall is tall): what its
      // floors are arranged for (views/atlas_fit.js).
      wallStage: ()=>{ const r = this.getAttribute("data-wall-rotate"), w = window.innerWidth || 0, h = window.innerHeight || 0;
        return r === "90" || r === "270" ? [h, w] : [w, h]; },
      wallArrange: this._wallArranges(),
      // The drawing already grows with the screen (a 4K wall draws it twice a
      // 1080p one); room names take the rest of the wall's scale.
      wallLabel: ()=>Math.max(1, (this._wallUi || 1) / (this._wallPx || 1)),
      showcase: !!this.state._showcase,
      liveColours: !!this.state._liveColours,
      showcaseTheme: this.state._showcaseTheme || "classic",
      fitRooms: !!this.state._fitRooms,
      isolux: !!this.state._isolux,
      // Read-only reflection, same reason as showcase/fitRooms/isolux above:
      // Automorph is set in Mapping -> Lights and this panel displays the
      // map that tab builds, so its aura must show here too, or the two
      // "identical" views disagree on what the house currently looks like.
      // No onAutomorph/onAutomorphRoomPct — this panel never edits modes.
      automorph: !!this.state._automorph,
      automorphRoomPct: this.state._automorphPct || 0,
      automorphHardness: this.state._automorphHardness || 0,
      automorphStyle: this.state._automorphStyle || "glow",
      automorphSubtlety: this.state._automorphSubtlety || 0,
      // Quick-apply only (2026-09-11: "a small preset button in the
      // lights tab for quick changes") — no onSavePreset/onDeletePreset, so
      // the shared preset bar renders Apply alone. Saving/deleting a look
      // stays an editing action for Mapping -> Lights, same line as the
      // read-only modes above.
      showcasePresets: this.state._showcasePresets || [],
      // Whole House Presets — quick-apply from the sidebar, same as the
      // Showcase presets above (2026-09-11 precedent: no edit UI in
      // the everyday panel, editing stays in Mapping -> Lights). Set/Delete
      // are included too, since this is the panel someone reaches for on a
      // wall kiosk without opening the full builder.
      wholeHousePresets: this.state._wholeHousePresets || [],
      onWholeHouseSet: async (name) => {
        const lights = Object.values(this.state.lightsByEid || {});
        const cap = captureWholeHouse(lights, this._hass?.states || {});
        const rest = (this.state._wholeHousePresets || []).filter((p) => p.name !== name);
        const preset = { name, created_at: Date.now() / 1000, entities: cap.entities };
        try { await this._ws({ type: "padspan_ha/settings_set", whole_house_presets: [...rest, preset] }); }
        catch (e) { return null; }
        this.state._wholeHousePresets = [...rest, preset];
        this._render();
        return cap;
      },
      onWholeHouseApply: async (preset) => {
        if (!this._hass) return null;
        try { return await applyWholeHouse(this._hass, preset); }
        catch (e) { return null; }
      },
      onWholeHouseDelete: async (name) => {
        const rest = (this.state._wholeHousePresets || []).filter((p) => p.name !== name);
        try { await this._ws({ type: "padspan_ha/settings_set", whole_house_presets: rest }); }
        catch (e) { return; }
        this.state._wholeHousePresets = rest;
        this._render();
      },
      // Vacation Mode's own "permanent option" — quick-apply from the
      // sidebar too, same as any other Whole House Preset here. The banner
      // itself (Disable + intensity slider), pinned dead-center of the
      // screen, is built into the shared card below (2026-09-21:
      // "I wanted the banner to show in the two atlas screens" — this one
      // and Mapping -> Atlas builder, nowhere else, so it lives in the shared
      // renderer rather than panel.js's global chrome).
      onVacationModeEnable: async () => {
        if (!this._hass) return false;
        let res = null;
        try { res = await this._ws({ type: "padspan_ha/settings_set", vacation_mode_enabled: true }); }
        catch (e) { return false; }
        this.state._vacationModeEnabled = true;
        this.state._vacationModeResumed = !!res?.settings?.vacation_mode_pattern_for;
        this._render();
        return true;
      },
      // The scene row under the map and in Live Aboard (views/scene_row.js):
      // Home Assistant's scenes and the one-floor Whole house presets above.
      // A tap goes through this panel's own calls (Home Assistant's services,
      // _setMany, the presets' Apply); + New scene and ✎ open Home
      // Assistant's scene editor, an administrator's, never on a wall.
      scenes: {
        slot: "atlas", states: this._hass?.states || {}, entities: this._hass?.entities || null,
        admin: !!this._hass?.user?.is_admin, kiosk,
        callService: (d, svc, data)=>this._hass.callService(d, svc, data),
        setMany: (eids, on)=>this._setMany(eids, on),
        openHa: (path)=>{
          try { history.pushState(null, "", path); window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } })); }
          catch (_) { try { window.location.assign(path); } catch (__) { /* stays here */ } }
        },
        toast: (m, e)=>this._toast(m, e),
        rerender: ()=>this._render(),
        telemetry: (name)=>{
          if(!this.state._telemetryOn || !this._hass) return;
          Promise.resolve(this._ws({ type:"padspan_ha/telemetry_event", event:String(name) })).catch(()=>{});
        },
      },
      vacationModeEnabled: !!this.state._vacationModeEnabled,
      vacationModeResumed: !!this.state._vacationModeResumed,
      vacationOptions: vacationOptionsOf(this.state._vacationSettings),
      onVacationLights: async () => {
        if (!this._hass) return null;
        try { return (await this._ws({ type: "padspan_ha/vacation_lights" }))?.lights || []; }
        catch (e) { return null; }
      },
      onVacationPreview: async () => {
        if (!this._hass) return null;
        try { return await this._ws({ type: "padspan_ha/vacation_preview" }); }
        catch (e) { return null; }
      },
      vacationModeEnds: vacationEndsText(this.state._vacationSettings),
      onVacationOptions: async (patch) => {
        if (!this._hass) return false;
        let res = null;
        try { res = await this._ws({ type: "padspan_ha/settings_set", ...patch }); }
        catch (e) { this._toast(t("Could not save the Vacation Mode option: {why}", { why: this._errorText(e) }), true); return false; }
        if (res?.settings) this.state._vacationSettings = res.settings;
        return true;
      },
      vacationModeIntensity: this.state._vacationModeIntensity || 100,
      onVacationModeDisable: async () => {
        if (!this._hass) return false;
        try { await this._ws({ type: "padspan_ha/settings_set", vacation_mode_enabled: false }); }
        catch (e) { this._toast(t("Could not disable Vacation Mode: {why}", { why: this._errorText(e) }), true); return false; }
        this.state._vacationModeEnabled = false;
        this._render();
        return true;
      },
      onVacationModeIntensity: async (pct) => {
        this.state._vacationModeIntensity = pct;
        try { await this._ws({ type: "padspan_ha/settings_set", vacation_mode_intensity: pct }); }
        catch (e) { this._toast(t("Could not change the intensity: {why}", { why: this._errorText(e) }), true); }
      },
      onApplyPreset: async (values) => {
        // The same one reading of the look as _loadSettings (and Traceback).
        const look = atlasLookFromSettings(values);
        this.state._showcase = look.showcase;
        this.state._showcaseTheme = look.showcaseTheme;
        this.state._fitRooms = look.fitRooms;
        this.state._isolux = look.isolux;
        this.state._hideDeviceCodes = look.hideDeviceCodes;
        this.state._hideUntouched = look.hideUntouched;
        this.state._automorph = look.automorph;
        this.state._automorphPct = look.automorphRoomPct;
        this.state._automorphHardness = look.automorphHardness;
        this.state._automorphStyle = look.automorphStyle;
        this.state._automorphSubtlety = look.automorphSubtlety;
        // Layout & view, when the preset carries it — the same keys
        // _loadSettings seeds this._view from, so the sidebar's sliders land
        // on the preset's numbers too. Optional: an older look leaves the
        // camera alone.
        if (values.overview_iso_floor_gap !== undefined && !this._wallFitted()) this._view.floorGap = values.overview_iso_floor_gap;
        if (values.overview_iso_horiz_gap !== undefined && !this._wallFitted()) this._view.horizGap = values.overview_iso_horiz_gap;
        if (values.overview_iso_focus !== undefined) this._view.focusIdx = values.overview_iso_focus ?? 0;
        if (values.overview_iso_zoom !== undefined) this._view.zoom = values.overview_iso_zoom;
        try { await this._ws({ type: "padspan_ha/settings_set", ...values }); }
        catch (e) { this._toast(t("Could not apply the preset: {why}", { why: this._errorText(e) }), true); }
        this._render();
      },
      // Same read-only reflection as the modes above — no onHideDeviceCodes,
      // this panel never edits it, only displays what Mapping -> Lights set.
      hideDeviceCodes: !!this.state._hideDeviceCodes,
      // Alert pulse (lights_map.js safetyAlerts): only when it is on.
      ...(this.state._alertPulse ? { alertPulse: true } : {}),
      ambient: sunAmbient(this._hass),
      // Rain or snow outside the floor plates, from the states this panel
      // already holds — nothing extra is asked of Home Assistant.
      weather: this.state._weather ? {
        slot: "atlas", settings: this.state._weather,
        states: this._hass?.states || {}, entities: this._hass?.entities,
        // The opt-in report's closed words, once per page load, and only
        // while the report is on (the trial card's rule).
        telemetry: (name)=>{
          if(!this.state._telemetryOn || !this._hass) return;
          Promise.resolve(this._ws({ type:"padspan_ha/telemetry_event", event:String(name) })).catch(()=>{});
        },
      } : null,
      // This screen is the house map (views/atlas_screen.js): zoomed in, the
      // flat map takes the whole panel too, it can go full screen, and a
      // double-tap on a room zooms to it; with Show people or Show tags &
      // scanners on, they show on it too (views/atlas_aboard.js). Mapping's
      // builder hands none of it. shownAt: when this panel was last opened
      // (Live Aboard's file is read again then, never on the poll).
      screen: { slot: "atlas", shownAt: this._shownAt || 0 },
      // The 3D house: the shared card draws its Map / 3D switch only while
      // the setting is on and the tier is Pro, and reads the rest from here.
      house3d: this.state._house3d ? {
        slot: "atlas", settings: this.state._house3d,
        // This screen is the house map: zoomed in, Live Aboard takes the
        // whole panel (every bar steps aside), and it can go full screen.
        mapOnly: true,
        // The sun's position (sun.sun) and the place (hass.config): no new calls.
        states: this._hass?.states || {}, config: this._hass?.config || null,
        // The director (live_aboard_director.js): the states as they are now.
        liveStates: ()=>this._hass?.states || {},
        // The 3D compass's Save: the GPS Bridge's own bearing,
        // fabric_bearing_deg, written alone and kept here at once.
        saveNorth: async (b)=>{
          const r = await this._ws({ type:"padspan_ha/settings_set", fabric_bearing_deg: b });
          const v = Number(r && r.settings && r.settings.fabric_bearing_deg);
          this.state._house3d = { ...(this.state._house3d || {}), fabric_bearing_deg: Number.isFinite(v) ? v : b };
          return true;
        },
        // Taps and holds in 3D: this map's own use api, asked for on the press.
        useApi: ()=>this._useApi(lightsByEid, lights),
        // Show people / Show tags & scanners from inside Live Aboard: an
        // administrator's, as in Settings, saved alone and drawn at once.
        admin: !!this._hass?.user?.is_admin,
        saveSetting: async (key, v)=>{
          await this._ws({ type:"padspan_ha/settings_set", [key]: v });
          this.state._house3d = { ...(this.state._house3d || {}), [key]: v };
          this._render();
          return true;
        },
        // The ⋯ list's links and "Set it up" (live_aboard_show.js GO_TO):
        // the PadSpan panel on that tab, its card scrolled to (panel.js reads
        // ?view=, ?tab= and ?part=). Not in Basic, where those are expert
        // screens, and never on a wall (kiosk), which would be left there.
        goTo: this._basicMode() || kiosk ? null : (t)=>{
          const q = new URLSearchParams({ view: String(t.view), tab: String(t.tab) });
          if (t.part) q.set("part", String(t.part));
          try { window.location.assign(`/padspan-ha?${q.toString()}`); } catch (_) { /* stays here */ }
        },
        kiosk,
        // Furniture that is a device (P5): renames followed through the
        // registry already read above, and the emergency lights while a
        // test runs (the status this panel already keeps).
        entities: this._hass?.entities || null, regIds: this._regStore?.reg?.regIds || null,
        // Show people (P6): this panel has no live snapshot of its own, so
        // the 3D view reads Overview's through here, only while Show people
        // is on and the view shows, never more often than Overview polls.
        // Optimize for scale: the slim snapshot (people only), and the last
        // one again while the page is hidden.
        people: { read: ()=>{
            if(this.state._optimizeScale && document.visibilityState === "hidden" && this._lastPeople) return Promise.resolve(this._lastPeople);
            const msg = this.state._optimizeScale ? { type:"padspan_ha/live_snapshot", slim:true } : { type:"padspan_ha/live_snapshot" };
            return this._hass.callWS(msg).then(r=>{ const snap = (r && r.snapshot) || null; if(snap) this._lastPeople = snap; return snap; });
          },
          everyMs: 1000 * (Number(this.state._house3d.presence_poll_interval_s) || 5) },
        // Trails: Traceback's own history (padspan_ha/traceback_get), read
        // by the view only while a screen has them on.
        trails: { read: (msg)=>this._hass.callWS(msg) },
        emergency: this.state._emerg && this.state._emerg.test && this.state._emerg.test.active
          ? (this.state._emerg.members || []).map(m => m && m.entity_id).filter(Boolean) : null,
        // The 3D file (doors and windows drawn in 3D, heights): read when
        // the 3D view shows, never on the poll.
        load: ()=>this._hass.callWS({ type:"padspan_ha/house3d_get" }),
        telemetry: (name)=>{
          if(!this.state._telemetryOn || !this._hass) return;
          Promise.resolve(this._ws({ type:"padspan_ha/telemetry_event", event:String(name) })).catch(()=>{});
        },
      } : null,
      // Same filter as the builder, from the same rule, over the same
      // placements — the map hides them, the index table below still lists
      // every light.
      hiddenEidsMap: this.state._hideUntouched
        ? new Set([...hidden, ...lights
            .filter(l => !lightIsTouched(l, this.state._shapeOverrides || {},
                                         (this.state.model || {}).light_positions_m || {}))
            .map(l => l.entity_id)])
        : hidden,
      lightsByEid,
      lightsLoading,
      // Read-only reflection of link status — no onConfigureDoor, this
      // sidebar has no Rooms tab of its own to jump to (that lives in
      // Mapping, a separate panel route); the table just shows whether a
      // door/window is linked, same status Mapping -> Lights shows.
      doorLinkedIds: new Set((this.state.model?.rf_barriers_m || [])
        .filter(b => b.linked_entity_id).map(b => b.linked_entity_id)),
      doorInvertByEid: doorInvertOf(this.state.model),
      view: this._view,
      // Every poll builds this card afresh: the map's drawing is patched from
      // the last one (lights_map.js drawStageSvg), not parsed again whole.
      patchSvg: true,
      // The index under the map, kept between updates (buildLightsTable);
      // on the poll's update a row holding the focused control stays as it is.
      keepTable: this._tableKeep || (this._tableKeep = {}),
      // The map card above it too (buildLightsMapCard): the same card while
      // it is built from the same, its drawing and stage kept as they are.
      keepCard: this._cardKeep || (this._cardKeep = {}),
      keepFocused: !!this._pollRender,
      saveView: ()=>this._saveSettings(),
      callWS: (msg)=>this._ws(msg),
      toast: (m,isErr)=>this._toast(m,isErr),
      // The use surface — wireUseSurface (shared). The renderer is asked for the
      // use-mode ergonomics: the code as its own tap target (codeChip), a
      // ≥44 px halo under every marker (hitHalo), the piles of unplaced
      // devices collapsed to one chip per room (collapseUnplaced), and the
      // layer chips' class filter. The Mapping tab's host asks for none of
      // these: there a click selects and a drag places.
      codeChip: true,
      hitHalo: true,
      collapseUnplaced: true,
      classFilter: this.state._classFilter,
      // The header's tip follows the ⋯ "Tap a light" tick as it is pressed, not at the next redraw.
      onShowLine: ()=>{ if(this._tipEl) this._tipEl.textContent = this._tipText(); },
      onClassFilter: (cls)=>{
        this.state._classFilter=cls;
        try{ localStorage.setItem(LS_CLASS, cls); }catch(_){}
        this._render();
      },
      // The heatmap layer chip (atlas_heatmap.js): off by default, this
      // browser remembers the last kind like the class filter above.
      // Only once it's turned on in Settings: until then no chip at all.
      // PadSpan Pro's or the Climate map add-on's, and only once it's turned
      // on in Settings: without either, or off, no chip at all.
      heatmap: this._heatmapPro() ? this.state._heatmap : null,
      onHeatmap: !this._heatmapPro() ? null : (kind)=>{
        this.state._heatmap=kind||null;
        try{ if(kind) localStorage.setItem(LS_HEAT, kind); else localStorage.removeItem(LS_HEAT); }catch(_){}
        this._render();
      },
      onHexesBuilt: (isoDiv)=>{
        requestAnimationFrame(()=>{
          const api = this._useApi(lightsByEid, lights);
          wireUseSurface(isoDiv, api);
          // The same hover HUD the builder has (2026-09-14: "the mouse
          // over works in mapping, lights, but not in lights tab"). Here an
          // "Under" pick does what a tap on that marker does — motion opens
          // its activity, a holdable device its controls, anything else
          // toggles — since this surface has no selection to make.
          wireHoverHud(isoDiv, {
            lightsByEid,
            isDragging: () => false,
            onPickUnder: (eid) => {
              const l0 = lightsByEid[eid];
              if (!l0) return;
              if (l0.isMotion) api.openActivity(eid);
              else if (api.controlsFor(l0)) api.openControls(eid);
              else if (tapSwitches(isoDiv, eid, l0)) api.toggle(eid);   // as a tap on it: not while ⋯'s "Tap a light" is unticked
            },
            underTitle: t("Act on this one instead — it's under the marker on top"),
            stackHint: null,
            roomLine: (room, n) => tn(n, "{room} — opens its {n} device", "{room} — opens its {n} devices", { room }),
            // Its height for Live Aboard, once it has one (Live Aboard on, at Pro):
            // the Heights list's lookup, with no Mapping draft here: the record's,
            // else Live Aboard's file's as this screen already read it (no read
            // of its own), as Live Aboard draws it.
            heightOf: this.state._house3d && this.state._house3d.atlas_3d_enabled === true
              && String(this.state._tier || "").toLowerCase() === "pro" ? (eid) => screenHeight("atlas", this.state.model, eid, lightsByEid[eid]) : null,
          });
        });
      },
      // A row in the list is the same object as its marker on the map, so a
      // tap here has to mean the same thing a tap THERE means — the map's
      // own click handler (wirePress in lights_map.js) already special-cases
      // motion to open its activity history instead of the read-only
      // refusal; this row click went through the generic toggle path
      // unconditionally and never got the same treatment, so clicking a
      // motion sensor in the list still said "read-only" long after tapping
      // its marker on the map started opening the calendar.
      onRowClick: (l)=> l.isMotion ? openActivityCalendar(this._hass, l.entity_id) : this._toggle(l.entity_id),
      onRowLongPress: (l)=>{ if(hasControlCard(l)) this._openWledDetail(l.entity_id); },
      // The "⋯" on every row: the controls in plain sight.
      onRowMore: (l)=>{ if(hasControlCard(l)) this._openWledDetail(l.entity_id); else this._toggle(l.entity_id); },
      onToggleHidden: (eid)=>{
        if(hidden.has(eid)) hidden.delete(eid);
        else hidden.add(eid);
        this._saveHidden();
        this._render();
      },
      afterAssign: ()=>{
        // Force a background registry refresh; keep serving the current copy.
        if(this._regStore.reg) this._regStore.reg.ts=0;
        this._render();
      },
      // A per-entity classification correction, not a presentation mode —
      // unlike showcase/fitRooms/isolux above, this panel DOES let you edit
      // it here, the same as Hide/Show and the Room-assignment dropdown
      // already do. Pro or Advanced smart lighting (_addon: Pro has it),
      // matching the Mapping tab's own gate.
      typeOverrides: this.state._typeOverrides,
      onTypeOverride: this._addon("lighting") ? async (eid, kind) => {
        const next = { ...this.state._typeOverrides };
        if (!kind || kind === "auto") delete next[eid]; else next[eid] = kind;
        this.state._typeOverrides = next;
        try { await this._ws({ type: "padspan_ha/settings_set", light_type_overrides: next }); }
        catch (e) { this._toast(t("Could not save the type override: {why}", { why: this._errorText(e) }), true); }
        this._render();
      } : null,
      // The index's own filter + sort — independent of the map's layer
      // chips (classFilter/onClassFilter above): this hides rows outright,
      // the ordinary meaning of "filter" for a list, so choosing a type
      // here never has the side effect of dimming the map too.
      tableClassFilter: this.state._tableClassFilter || "all",
      onTableClassFilter: (cls)=>{ this.state._tableClassFilter=cls; this._render(); },
      tableSort: this.state._tableSort || null,
      onTableSort: (next)=>{ this.state._tableSort=next; this._render(); },
      tableHealthFilter: !!this.state._tableHealthFilter,
      onTableHealthFilter: (on)=>{ this.state._tableHealthFilter=on; this._render(); },
      zigbeeTwins,
      floodLatches: this.state._floodLatches || {},
      onFloodReset: (eid)=>{
        this._ws({ type: "padspan_ha/flood_reset", entity_id: eid })
          .then(()=>this._render())
          .catch((e)=>this._toast(t("Could not reset: {why}", { why: this._errorText(e) }), true));
      },
    };

    const mapCard=buildLightsMapCard(host);
    parts.push(mapCard);
    // "Test emergency lighting" floats over the map's TOP-right corner (the
    // map's top is on screen when the Atlas opens; its bottom often is not):
    // a zero-height anchor right before the stage, so nothing moves.
    // A kept card (host.keepCard) still holds the last one: it comes out first.
    const emerg=this._emergencyOverlay();
    for(const n of [...mapCard.childNodes]) if(n.classList && n.classList.contains("lv-emerg-anchor")) mapCard.removeChild(n);
    const stage=emerg && mapCard.querySelector(".lv-stage");
    if(stage) stage.parentNode.insertBefore(emerg, stage);

    // ── The 90-day trial, under the free map it would unlock ──────────────────
    if(!paid){
      const trial=this._trialCard();
      if(trial) parts.push(trial);
    }

    // ── Unassigned notice + light index table (shared with the Mapping tab) ──
    parts.push(buildLightsTable(host, lights));

    return parts;
  }

  // The trial card (views/trial_offer.js) with this panel as its host. Null
  // when hidden on this browser, or when there is nothing to offer.
  _trialCard(){
    if(this.state._trialHidden) return null;
    return trialOfferCard({
      el,
      settings: this.state._trialSettings,
      isAdmin: this._isAdmin(),
      callWS: (type, data)=>this._ws({ type, ...(data||{}) }),
      telemetry: (name)=>{
        if(!this.state._telemetryOn) return;
        this._ws({ type:"padspan_ha/telemetry_event", event:String(name) }).catch(()=>{});
      },
      toast: (m,e)=>this._toast(m,e),
      rerender: ()=>this._render(),
      // The key is live the moment the command returns: re-read settings so
      // the tier (and with it placement, shapes and the rest) follows.
      onStarted: ()=>{ this._loadSettings(false).then(()=>this._render()); },
    }, "atlas", {
      onDismiss: ()=>{
        this.state._trialHidden=true;
        try{ localStorage.setItem(LS_TRIAL_HIDDEN,"1"); }catch(_){}
        this._render();
      },
    });
  }

  // Every PadSpan command this page sends goes through here. Enhanced
  // security is on and this person is not an admin
  // (ws_common.require_admin_if_enhanced): say so plainly, the way panel.js
  // does, and keep that message up over the caller's own "could not" toast.
  // Anything else is passed on untouched.
  _ws(msg){
    return Promise.resolve(this._hass.callWS(msg)).catch(err => {
      if(err && err.code === "admin_only"){
        this._toast(err.message || "Only an admin can change this while Enhanced security is on");
        this._adminOnlyToastUntil = Date.now() + 4500;
      }
      throw err;
    });
  }

  /** views/ui_error.js errorText, or the error's own text until that module has loaded. */
  _errorText(e){
    if (UI_ERROR && UI_ERROR.errorText) return UI_ERROR.errorText(e);
    return (e && typeof e.message === "string" && e.message) || (typeof e === "string" && e) || t("Something went wrong. Try again.");
  }

  _toast(msg, isError=false, durationMs=null){
    if(isError && this._adminOnlyToastUntil && Date.now() < this._adminOnlyToastUntil) return;
    const t=document.createElement("div");
    t.textContent=msg;
    t.style.cssText=`position:fixed;bottom:24px;left:50%;transform:translateX(-50%);`+
      // Above the emergency card's overlay (10000) — phone sheet and desktop
      // card alike — and click-through, so it never covers a button.
      `padding:10px 18px;border-radius:12px;font-size:13px;color:#e2e8f0;z-index:10001;pointer-events:none;`+
      `background:${isError?"rgba(127,29,29,.92)":"rgba(16,40,26,.92)"};`+
      `border:1px solid ${isError?"#dc2626":"rgba(82,183,136,.6)"};`+
      `backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);`+
      `box-shadow:0 8px 30px rgba(0,0,0,.5),0 0 20px ${isError?"rgba(220,38,38,.2)":"rgba(82,183,136,.15)"};`+
      `white-space:pre-wrap;max-width:320px;text-align:center`;
    // One at a time: a new message replaces the last rather than landing on it.
    if(this._toastEl) this._toastEl.remove();
    this._toastEl = t;
    document.body.appendChild(t);
    // Long enough to read: the emergency messages run to a few sentences.
    // A message tied to a window (Force off's "tap again") passes its own.
    const ms = durationMs || Math.min(10000, Math.max(3500, String(msg).length * 60));
    setTimeout(()=>{ t.remove(); if(this._toastEl === t) this._toastEl = null; }, ms);
  }

  connectedCallback(){
    if(!this.shadowRoot) this.attachShadow({mode:"open"});
    this._shownAt = Date.now();
    // Track a held pointer so the 5s poll can't re-render mid-interaction
    // (dragging a slider is the case that actually bites).
    if(!this._pointerWired){
      this._pointerWired = true;
      // In the capture phase: a map marker's own pointerdown stops the event
      // there (wirePress), so heard on the way up this never saw a hold on a
      // light, and a poll landing mid-hold cut the dim short. The release is
      // heard first on the way down too, so no handler can leave it stuck.
      this.addEventListener("pointerdown", ()=>{ this._pointerDown = true; this._pointerDownAt = Date.now(); }, true);
      // A release that never arrives (a context menu, the window left mid-hold)
      // must not stop the updates: leaving the window ends the hold.
      window.addEventListener("blur", ()=>{ this._pointerDown = false; });
      window.addEventListener("pointerup", ()=>{ this._pointerDown = false; }, true);
      window.addEventListener("pointercancel", ()=>{ this._pointerDown = false; }, true);
    }
    // Uncaught errors with PadSpan code on the stack, counted for the opt-in
    // report as ui_error:<module> + ui_error_while:atlas. The backend drops
    // the event unless the report is switched on.
    if(!this._uiErrorHandler){
      this._uiErrorHandler = (ev)=>{
        try{
          if(!UI_ERROR || !this._hass) return;
          UI_ERROR.reportUiError(ev, "atlas", (name)=>{
            Promise.resolve(this._ws({ type:"padspan_ha/telemetry_event", event:name })).catch(()=>{});
          });
        }catch(_e){ /* the error reporter must never be the error */ }
      };
      window.addEventListener("error", this._uiErrorHandler);
      window.addEventListener("unhandledrejection", this._uiErrorHandler);
    }
    // The opt-in report's look at this screen (client_perf.js): frame rate and
    // heap once a minute ("atlas", or "sim" while the 3D house draws), the
    // device class once per page load — only while the report is on.
    if(!this._clientPerf && !this._clientPerfLoading){
      this._clientPerfLoading = import(`./client_perf.js${STAMP}`).then((m)=>{
        this._clientPerfLoading = null;
        if(!this.isConnected || this._clientPerf) return;
        this._clientPerf = m.startClientPerf({
          root: this.shadowRoot, viewClass: ()=>"atlas",
          enabled: ()=>!!this.state._telemetryOn && !!this._hass,
          send: (name, extra)=>{
            const screen = extra && typeof extra.screen === "string" ? { screen: extra.screen } : {};
            Promise.resolve(this._ws({ type:"padspan_ha/telemetry_event", event:name, ...screen })).catch(()=>{});
          },
        });
      }).catch(()=>{ this._clientPerfLoading = null; });
    }
    this.style.display="block";
    this._wallOn();
    this.shadowRoot.innerHTML=`
      <link rel="stylesheet" href="/padspan_ha_static/padspan-ha/styles.css?v=${APP_VERSION}&b=${BUILD_ID}">
      <style>
        :host{display:block;min-height:100vh;background:#0a150e;color:#e2e8f0;accent-color:#52b788;
              font-family:Inter,system-ui,Arial,sans-serif;box-sizing:border-box}
        #content{padding:16px}
        /* A phone: the map card runs edge to edge, the rest keeps its margin
           (the card's rail is a row there: styles.css). */
        @media (max-width:600px){
          :host(:not([data-wall])) #content .lv-mapcard.lv-display{margin-left:-16px;margin-right:-16px;border-radius:0;border-left:none;border-right:none}
        }
        /* Wall mode (?kiosk=1): no header, the map card the whole screen,
           its controls scaled by --wall-ui (lv- rules in styles.css). */
        :host([data-wall]){overflow:clip}
        /* A wall turned by its link (?wall_rotate): the page is laid out
           as tall as the screen is wide and turned onto it. */
        :host([data-wall][data-wall-rotate]){position:fixed;top:0;left:0;width:100vh;height:100vw;transform-origin:top left}
        :host([data-wall][data-wall-rotate="90"]){transform:rotate(90deg) translateY(-100%)}
        :host([data-wall][data-wall-rotate="270"]){transform:rotate(-90deg) translateX(-100%)}
        :host([data-wall][data-wall-rotate]) .lv-mapcard.lv-display.lv-wall{height:100vw}
        :host([data-wall]) #content{padding:0}
        :host([data-wall]) .lv-hero, :host([data-wall]) .lv-coach{display:none}
        /* The wall is the map: the lights' table under it stays on the desk's
           Atlas (a wall could scroll down to it, with a scrollbar on show). */
        :host([data-wall]) .lv-tablecard.lv-index{display:none}
        /* Nobody at the wall: the controls floating over the map and the 3D
           house fade away (they come back with a touch, a mouse or a key),
           so a big wall shows the house, not its buttons. */
        /* The ⋯ beside the compass goes and comes back with it; so do the
           Motion chip (and its colour key, if open), Live Aboard's Rooms ▾ and the flat map's scene row. */
        :host([data-wall]) .la3d-bar, :host([data-wall]) .la3d-compass, :host([data-wall]) .la3d-more, :host([data-wall]) .la3d-hud, :host([data-wall]) .la3d-rchips,
        :host([data-wall]) .la3d-mchip, :host([data-wall]) .la3d-mkey, :host([data-wall]) .psc-atlas,
        :host([data-wall]) .lv-alone-anchor > button{transition:opacity .6s ease}
        :host([data-wall]:not([data-wall-active])) .la3d-bar, :host([data-wall]:not([data-wall-active])) .la3d-compass,
        :host([data-wall]:not([data-wall-active])) .la3d-more, :host([data-wall]:not([data-wall-active])) .la3d-hud, :host([data-wall]:not([data-wall-active])) .la3d-rchips,
        :host([data-wall]:not([data-wall-active])) .la3d-mchip, :host([data-wall]:not([data-wall-active])) .la3d-mkey,
        :host([data-wall]:not([data-wall-active])) .psc-atlas,
        :host([data-wall]:not([data-wall-active])) .lv-alone-anchor > button{opacity:0;pointer-events:none}
        :host([data-wall]:not([data-wall-active])) .psc-atlas *{pointer-events:none}
      </style>
      <div id="content"></div>
    `;
    if(this._booted) this._render();
    // Back on screen after a disconnect (the Atlas as the main panel's
    // Overview is moved between redraws and tabs): disconnectedCallback
    // stopped the poll, and only _boot starts it.
    if(this._booted && !this._pollTimer){
      this._pollTimer = setInterval(()=>this._poll(), 5000);
      this._poll();
    }
  }

  // Wall mode: ?kiosk=1 on the sidebar Atlas (not the Atlas shown as the
  // panel's Overview, which lives inside the panel's own page), with the new
  // layout's rail (PadSpan Pro): the fitted map is that layout's. A classic
  // layout on ?kiosk=1 stays exactly as it was. Asked again at every build,
  // since the tier and layout arrive with the settings.
  _wallOn(){
    let kiosk = false;
    try { kiosk = new URLSearchParams(location.search).get("kiosk") === "1"; } catch(_) {}
    // The plain wall mode's rung (editions.js wallTier): Pro on the new layout, as it was; where it has
    // moved down the ladder, a lower tier's wall draws the new layout's map whatever the layout setting.
    const pro = String(this.state?._tier || "").toLowerCase() === "pro";
    const v2 = pro ? !!this.state?._atlasLayoutV2 : tierAtLeast(this.state?._tier, wallTier(!!this.state?._freeBasics));
    if(!kiosk || this._embedded || !v2 || !WALLS){
      // Also when a wall stops being one without a reload (the layout or
      // the tier changed elsewhere): nothing of the wall is left behind.
      this.removeAttribute("data-wall");
      this.removeAttribute("data-wall-rotate");
      this._wallOff();
      this._wallNight(); this._wallShift(); this._wallCycle();
      return;
    }
    this.setAttribute("data-wall", "");
    // The wall is the whole screen: Home Assistant's own sidebar goes too, on
    // this browser (Hide HA's switch; Show HA on the Atlas brings it back).
    if(HA_SIDEBAR && this._hass && this.isConnected && !this._wallHidHa && !HA_SIDEBAR.haHidden(this._hass)){
      this._wallHidHa = true;
      HA_SIDEBAR.toggleHaSidebar(this, this._hass);
    }
    const size = ()=>{
      const p = this._wallParams();
      // A screen hung on its side whose TV can't turn its picture
      // (?wall_rotate=90|270): the page turns itself, and is sized for the
      // picture as it hangs (width and height swapped).
      const rot = p.rotate || 0;
      if(rot) this.setAttribute("data-wall-rotate", String(rot)); else this.removeAttribute("data-wall-rotate");
      const W = rot ? window.innerHeight : window.innerWidth, H = rot ? window.innerWidth : window.innerHeight;
      const s = WALLS.wallScale(W, H, { ...p, dpr: window.devicePixelRatio || 1 });
      this.style.setProperty("--wall-ui", String(s));
      // How much bigger the drawing itself is than on 1080p, either way up: the rain goes with it.
      this._wallPx = Math.max(1, WALLS.screenRatio ? WALLS.screenRatio(W, H) : Math.min(W / 1920, H / 1080));
      this.style.setProperty("--wall-px", String(Math.round(this._wallPx * 100) / 100));
      // The buttons stop at finger size (wall_scale.js controlScale).
      this.style.setProperty("--wall-ctl", String(WALLS.controlScale(s, p.inches, W, H, window.devicePixelRatio || 1)));
      this._wallUi = s;
      this._wallFit = p.inches > 0 ? "room" : "auto";
    };
    size();
    this._wallNight();
    this._wallShift();
    this._wallCycle();
    // Someone at the wall: its floating controls show for 30 s after the
    // last touch, mouse move or key, then fade (the CSS above).
    if(!this._wallWake){
      const wake = ()=>{
        this.setAttribute("data-wall-active", "");
        clearTimeout(this._wallIdleTimer);
        this._wallIdleTimer = setTimeout(()=>this.removeAttribute("data-wall-active"), 30000);
      };
      this._wallWake = wake;
      for(const ev of ["pointerdown", "pointermove", "keydown", "wheel"]) window.addEventListener(ev, wake, { passive: true });
      // The first touch on a faded wall brings the controls back, and where
      // it lands on one of them (hidden, so it would reach whatever is under
      // it: a light, the 3D house) it does nothing else. Anywhere else (the
      // rail, a light, the map, all still showing) it works as a tap. A mouse
      // has already woken it by moving.
      const FADED = ".la3d-bar, .la3d-compass, .la3d-more, .la3d-hud, .la3d-rchips, .la3d-mchip, .la3d-mkey, .psc-atlas .psc-scroll, .lv-alone-anchor > button";
      const onFaded = (x, y)=>[...(this.shadowRoot ? this.shadowRoot.querySelectorAll(FADED) : [])].some(el=>{
        const r = el.getBoundingClientRect();
        return r.width > 0 && x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
      });
      this._wallTap = (e)=>{
        if(e.type === "pointerdown"){
          if(this.hasAttribute("data-wall-active")) return;
          wake();
          if(!onFaded(e.clientX, e.clientY)) return;
          e.stopPropagation(); e.preventDefault();
          this._wallTapAt = Date.now();
        } else if(Date.now() - (this._wallTapAt || 0) < 800){
          e.stopPropagation(); e.preventDefault();
        }
      };
      window.addEventListener("pointerdown", this._wallTap, true);
      window.addEventListener("click", this._wallTap, true);
      wake();
    }
    if(!this._wallResize){ this._wallResize = size; window.addEventListener("resize", size); }
    // Keep the screen on (Wake Lock): a wall nobody touches must not go to
    // sleep. Only on HTTPS or localhost; elsewhere the browser's own setting
    // decides, as before. Asked again when the page is shown again.
    const ask = ()=>{
      if(!navigator.wakeLock || document.visibilityState !== "visible" || (this._wakeLock && !this._wakeLock.released)) return;
      navigator.wakeLock.request("screen").then(l=>{ this._wakeLock = l; }).catch(()=>{});
    };
    ask();
    if(!this._wakeVis){ this._wakeVis = ask; document.addEventListener("visibilitychange", ask); }
  }

  // The wall's settings and its link's. Night dimming (Fully Kiosk's with it), the burn-in shift and
  // showing each floor in turn are Pro's: below Pro the plain wall has none of them, whatever is stored.
  _wallParams(){
    const p = WALLS.wallParams(location.search, this.state?._wall);
    return String(this.state?._tier || "").toLowerCase() === "pro" ? p : { ...p, dim: 0, shift: false, cycle: 0, fully: false };
  }
  // Night dimming on a wall: after sunset the whole picture is that much
  // darker (an overlay: cheaper than a filter over a 3D view). Asked at every
  // build, so it follows the sun with the poll.
  _wallNight(){
    const r = this.shadowRoot;
    if(!r) return;
    const p = this.hasAttribute("data-wall") ? this._wallParams() : null;
    const dim = p ? p.dim : 0;
    const night = this._hass?.states?.["sun.sun"]?.state === "below_horizon";
    let d = r.querySelector("#wallDim");
    // Inside Fully Kiosk, with "Use Fully Kiosk" on: the screen itself is
    // turned down (its backlight, darker than any overlay), and its motion
    // detection turns a sleeping screen back on.
    const fully = p && p.fully ? this._fully() : null;
    this._wallFullyMotion(fully);
    if(fully){
      if(d) d.remove();
      try {
        if(dim > 0 && night){
          if(this._fullyDay == null) this._fullyDay = Number(fully.getScreenBrightness());
          const want = WALLS.fullyBrightness(this._fullyDay, dim);
          if(want !== this._fullyAt){ fully.setScreenBrightness(want); this._fullyAt = want; }
        } else this._fullyRestore();
      } catch(_) {}
      return;
    }
    this._fullyRestore();
    if(!(dim > 0 && night)){ if(d) d.remove(); return; }
    if(!d){
      d = document.createElement("div"); d.id = "wallDim";
      d.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;background:#000;pointer-events:none;z-index:2147483000;transition:opacity 4s";
      r.appendChild(d);
    }
    d.style.opacity = String(dim);
  }
  // Fully Kiosk Browser's JavaScript interface, when this page runs in it
  // (and its "Enable JavaScript Interface" is on); null anywhere else.
  _fully(){
    const f = typeof window !== "undefined" ? window.fully : null;
    return f && typeof f.setScreenBrightness === "function" && typeof f.getScreenBrightness === "function" ? f : null;
  }
  // The day's brightness back, after a night turned Fully's screen down.
  _fullyRestore(){
    if(this._fullyDay == null) return;
    const f = this._fully();
    try { if(f) f.setScreenBrightness(this._fullyDay > 0 ? Math.round(this._fullyDay) : -1); } catch(_) {}
    this._fullyDay = null; this._fullyAt = null;
  }
  // Fully's motion detection (its camera; on in Fully's own settings): motion
  // in front of a wall whose screen is off turns it back on. Fully keeps a
  // binding for the page's life, so it is made once and asks this hook.
  _wallFullyMotion(fully){
    if(!fully || typeof fully.bind !== "function"){
      if(window.__padspanWallMotion === this._motionHook) window.__padspanWallMotion = null;
      return;
    }
    if(!this._motionHook){
      this._motionHook = ()=>{
        const f = this._fully();
        try { if(f && typeof f.getScreenOn === "function" && !f.getScreenOn()) f.turnScreenOn(); } catch(_) {}
      };
    }
    window.__padspanWallMotion = this._motionHook;
    if(!window.__padspanWallMotionBound){
      try { fully.bind("onMotion", "window.__padspanWallMotion && window.__padspanWallMotion()"); window.__padspanWallMotionBound = true; } catch(_) {}
    }
  }
  // A wall nobody is touching can show its floors in turn, every
  // wall_floor_cycle_s seconds (off unless set): All, then each floor
  // (lights_map.js view.wallStops). It waits while someone uses the wall
  // (its controls are showing) and while the page is hidden.
  _wallCycle(){
    const s = this.hasAttribute("data-wall") ? this._wallParams().cycle : 0;
    if(s === this._cycleS) return;
    if(this._cycleTimer){ clearInterval(this._cycleTimer); this._cycleTimer = null; }
    this._cycleS = s;
    if(!s) return;
    this._cycleTimer = setInterval(()=>{
      if(this.hasAttribute("data-wall-active") || document.visibilityState === "hidden") return;
      const next = WALLS.nextFloorStop(this._view.wallStops, this._view.focusIdx);
      if(next == null || next === this._view.focusIdx) return;
      this._view.focusIdx = next;
      this._render();
    }, s * 1000);
  }
  // Against burn-in on an OLED wall: the picture moves a couple of pixels
  // round a small square, one step every three minutes, so no edge stays lit
  // on the same pixels for hours. Off unless asked for.
  _wallShift(){
    const on = this.hasAttribute("data-wall") && this._wallParams().shift;
    // Everything the page draws: #content, and Live Aboard's full screen,
    // which moves its view out to the top of the page (paintCover). The
    // `translate` property, not transform: it adds to theirs.
    const moveAll = (x, y)=>{
      for(const el of (this.shadowRoot ? this.shadowRoot.children : [])){
        if(el.tagName !== "STYLE" && el.id !== "wallDim") el.style.translate = x || y ? `${x}px ${y}px` : "";
      }
    };
    if(!on){
      if(this._shiftTimer){ clearInterval(this._shiftTimer); this._shiftTimer = null; moveAll(0, 0); }
      return;
    }
    if(this._shiftTimer) return;
    const orbit = [[0,0],[2,0],[2,2],[0,2],[-2,2],[-2,0],[-2,-2],[0,-2],[2,-2]];
    let i = 0;
    this._shiftTimer = setInterval(()=>{
      i = (i + 1) % orbit.length;
      moveAll(orbit[i][0], orbit[i][1]);
    }, 180000);
  }

  // What a wall set up on the window and the host, undone.
  // The heatmap chip: PadSpan Pro or the Climate map add-on, and turned on in Settings → Atlas → Atlas — Mapped Light Control.
  _heatmapPro(){
    return this._addon("climate") && !!this.state._heatmapOn;
  }

  _wallOff(){
    if(this._wallResize){ window.removeEventListener("resize", this._wallResize); this._wallResize = null; }
    if(this._wallWake){
      for(const ev of ["pointerdown", "pointermove", "keydown", "wheel"]) window.removeEventListener(ev, this._wallWake);
      window.removeEventListener("pointerdown", this._wallTap, true);
      window.removeEventListener("click", this._wallTap, true);
      this._wallWake = null; this._wallTap = null; clearTimeout(this._wallIdleTimer);
    }
    if(this._wakeVis){ document.removeEventListener("visibilitychange", this._wakeVis); this._wakeVis = null; }
    if(this._wakeLock){ try { this._wakeLock.release(); } catch(_) {} this._wakeLock = null; }
    this.style.removeProperty("--wall-ui");
    this.style.removeProperty("--wall-ctl");
    this.style.removeProperty("--wall-px");
    this.removeAttribute("data-wall-active");
    this._wallUi = 1;
  }

  disconnectedCallback(){
    if(this._pollTimer){ clearInterval(this._pollTimer); this._pollTimer=null; }
    if(this._shiftTimer){ clearInterval(this._shiftTimer); this._shiftTimer = null; }
    if(this._cycleTimer){ clearInterval(this._cycleTimer); this._cycleTimer = null; this._cycleS = 0; }
    this._fullyRestore();
    if(window.__padspanWallMotion === this._motionHook) window.__padspanWallMotion = null;
    this._wallOff();
    if(this._clientPerf){ this._clientPerf.stop(); this._clientPerf = null; }
    if(this._uiErrorHandler){
      window.removeEventListener("error", this._uiErrorHandler);
      window.removeEventListener("unhandledrejection", this._uiErrorHandler);
      this._uiErrorHandler = null;
    }
    if(this._reconnectsStop) this._reconnectsStop();
    this._reconnectsStop = null; this._reconnectsConn = null;
    if(this._screen) this._screen.leave();
    if(this._emergCard) this._emergCard.close();
    if(this._rc) this._rc.close();                 // Audio's matching card, over the page, goes with the panel
    clearTimeout(this._emergArmTimer);
  }
}

// Guard against duplicate definition when a stale module lingers alongside a
// freshly-registered one after an integration reload (see panel.js for detail).
if (!customElements.get("padspan-lights-app")) {
  customElements.define("padspan-lights-app", PadSpanLightsApp);
}
