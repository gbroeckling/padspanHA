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

const APP_VERSION = "0.38.99";
const BUILD_ID = "20261005T165017Z";

// Query inherited from our own module URL so the ?b= cache-buster propagates
// (see docs/06_UI_CACHE_BUSTING.md).
const { hasControlCard } =
  await import(`./views/light_codes.js${new URL(import.meta.url).search}`);
// THE shared lights view — data pipeline, map card and index table, also used
// verbatim by the Mapping → Lights tab (the builder for this display), so the
// two tools always show the identical map. All lights-view edits go in there.
const { ensureLightsRegistry, gatherLights, buildLightsMapCard, buildLightsTable, lightIsTouched,
        sunAmbient, toggleEntity, atlasLookFromSettings,
        wireUseSurface, openControlCard, controlApiFor, openRoomSheet, openFloorSheet, openActivityCalendar, setManyStates, doorInvertOf,
        wireHoverHud, captureWholeHouse, applyWholeHouse, ensureExactDevices } =
  await import(`./views/lights_map.js${new URL(import.meta.url).search}`);
const { keepSubscribed } =
  await import(`./views/push_subscription.js${new URL(import.meta.url).search}`);
// The 90-day trial card, shared with every other paid wall. Optional: a card
// that fails to load must not blank the house map.
const { trialOfferCard } = await import(`./views/trial_offer.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: trial_offer failed to load", err); return { trialOfferCard: () => null }; });
// Which PadSpan module an uncaught error came from (see panel.js "Uncaught
// panel errors"). Not awaited: the sidebar must come up without it.
let UI_ERROR = null;
import(`./views/ui_error.js${new URL(import.meta.url).search}`)
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
const LS_HIDDEN = "padspan_ha_lights_hidden";
// The one-time coach mark ("tap to switch · code or hold for controls") —
// per browser, because that is where the hands are.
const LS_COACH = "padspan_ha_lights_coach_seen";
const LS_CLASS = "padspan_ha_lights_class";
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
      try{ this._hass.callWS({ type:"padspan_ha/settings_set", lights_hidden: arr }); }catch(_){}
    }
  }

  set hass(hass){
    this._hass = hass;
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
    this._loadModel().then(()=>this._render());
    // Clear again AFTER the awaits: two overlapping boots (a second Refresh
    // click while the first is still loading) both pass the clear above before
    // either assigns, and the first timer would be orphaned beyond reach.
    if(this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(()=>this._poll(), 5000);
  }

  async _poll(){
    if(!this._hass) return;
    // Don't rebuild the DOM under the user's hands: a poll landing mid-drag on
    // a slider, or while a select is open, destroys the control being used.
    // (The Mapping tab's host has the same protection via _editDragging.)
    // INPUT/SELECT only. A button KEEPS focus after it is clicked, so
    // including BUTTON here meant one press of Zoom+ stopped this panel
    // live-updating for good.
    const active = this.shadowRoot && this.shadowRoot.activeElement;
    if(active && /^(INPUT|SELECT)$/.test(active.tagName)) return;
    if(this._pointerDown) return;
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
    this._render();   // registry staleness handled inside _buildUI
  }

  async _loadModel(){
    try{
      const res = await this._hass.callWS({ type:"padspan_ha/model_get" });
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
      const res = await this._hass.callWS({ type:"padspan_ha/settings_get" });
      s = res?.settings || {};
    }catch(e){}
    try{
      if(applyView){
        this._view.floorGap = s.overview_iso_floor_gap ?? 150;
        this._view.horizGap = s.overview_iso_horiz_gap ?? 0;
        this._view.focusIdx = s.overview_iso_focus     ?? 0;
        // Persisted zoom (Garry, 2026-09-22: "stabilize the zoom in, so when
        // that is locked well, it can stay that way for months") — this
        // panel is set up once and left running unattended; an in-memory
        // zoom reset to 1.0 on every reboot/reload.
        this._view.zoom     = s.overview_iso_zoom      ?? 1.0;
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
      // Outdoor weather (Settings → UI Structure → Atlas), field by field. A
      // failed fetch keeps the last answer; before any answer, no weather.
      if (s.atlas_weather_enabled !== undefined) {
        this.state._weather = {
          atlas_weather_enabled: s.atlas_weather_enabled,
          atlas_weather_rain_entity: s.atlas_weather_rain_entity,
          atlas_weather_condition_entity: s.atlas_weather_condition_entity,
          atlas_weather_warning_entity: s.atlas_weather_warning_entity,
          atlas_weather_strength: s.atlas_weather_strength,
        };
      }
      // The 3D house (Settings → UI Structure → Atlas → 3D house), normally
      // off. A failed fetch keeps the last answer; before any, no switch.
      if (s.atlas_3d_enabled !== undefined) {
        this.state._house3d = { atlas_3d_enabled: s.atlas_3d_enabled, atlas_3d_quality: s.atlas_3d_quality,
          fabric_bearing_deg: s.fabric_bearing_deg, atlas_3d_weather: s.atlas_3d_weather, atlas_3d_showcase: s.atlas_3d_showcase,
          atlas_3d_people: s.atlas_3d_people, presence_poll_interval_s: s.presence_poll_interval_s, light_shapes: s.light_shapes,
          atlas_3d_tags: s.atlas_3d_tags };
      }
      this.state._wholeHousePresets = Array.isArray(s.whole_house_presets) ? s.whole_house_presets : [];
      // Layout v2 (Garry, 2026-09-21) is a house-wide trial toggle, set
      // from the builder only — this panel reflects it, same convention
      // as showcase/automorph above, but renders its OWN DISPLAY variant
      // (host.displayMode below): edge-to-edge map, a slim rail, no
      // onLayoutV2 handed to the host, so no toggle button shows here.
      this.state._atlasLayoutV2 = !!s.atlas_layout_v2;
      // Vacation Mode's own state — read here too now that the banner lives
      // in the shared Atlas card (both hosts), not panel.js's global chrome.
      this.state._vacationModeEnabled = !!s.vacation_mode_enabled;
      this.state._vacationModeIntensity = Number.isFinite(Number(s.vacation_mode_intensity)) ? Number(s.vacation_mode_intensity) : 100;
      // {entity_id: epoch-s of its most recent "on"} — flood_latch.py's
      // event listener writes this server-side; ungated, same reasoning as
      // the tier read above (a flood alarm isn't a paid convenience).
      this.state._floodLatches = (s.flood_latches && typeof s.flood_latches === "object") ? s.flood_latches : {};
      // The effective tier the backend computed (licence.py). Below `bright`
      // the shared pipeline draws the free map — see lights_map.js. A settings
      // fetch that failed keeps the tier it last knew rather than flickering
      // a Pro house down to the free drawing for one poll.
      if (s.tier !== undefined) this.state._tier = String(s.tier);
      // What the trial card reads: whether any key exists, and the tier (a
      // failed fetch keeps the last answer, same as the tier above); and
      // whether the usage report is on, so its offer counts only leave the
      // browser when it is (panel.js _telemetryEvent's rule).
      if (s.pro_has_key !== undefined) {
        this.state._trialSettings = { pro_has_key: s.pro_has_key, tier: s.tier,
          edition: s.edition, bright_reveal_presence: s.bright_reveal_presence };
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
    try{ r = await this._hass.callWS({ type:"padspan_ha/emergency_status" }); }
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
      this._toast(queue ? "Still switching… Force off runs next." : "Still switching…");
      return;
    }
    this._emergBusy = true;
    this._emergSeq = (this._emergSeq || 0) + 1;
    this._render();                                  // the busy state on the button
    try{
      const r = await this._hass.callWS(msg);
      this._emergApply(r);
      const name = {};
      for(const m of (r && r.members) || []) name[m.entity_id] = m.name || m.entity_id;
      const names = (ids)=>ids.map(e=>name[e]||e).join(", ");
      const res = (r && r.results) || [];
      const unreachable = res.filter(x=>x.skipped==="unavailable" || x.skipped==="missing").map(x=>x.entity_id);
      const failed = res.filter(x=>!x.ok && !x.skipped).map(x=>x.entity_id);
      const lines = [done(r, names)];
      if(unreachable.length) lines.push(`Not reachable: ${names(unreachable)}`);
      if(failed.length) lines.push(`Could not switch: ${names(failed)}`);
      if(lines.filter(Boolean).length) this._toast(lines.filter(Boolean).join("\n"), failed.length > 0);
    }catch(e){
      this._toast("Emergency lighting: " + String((e && e.message) || e), true);
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
    const t = (this.state._emerg && this.state._emerg.test) || {};
    const left = [...(t.kept_on || []), ...(t.manual || [])];
    this._emergencyCall({ type:"padspan_ha/emergency_test", on: !t.active }, (r, names)=>{
      const real = ((r && r.results) || []).find(x => x && x.kept === "emergency");
      if(t.active && real) return `Emergency lighting test ended. ${(real.by || []).join(", ")} ran during the test, so every emergency light was left on. Turn them off from the list (the ring) when you're ready.`;
      if(t.active) return "Emergency lighting test ended." + (left.length ? `\nLeft on or as set: ${names(left)}` : "");
      const k = (r && r.test && r.test.kept_on) || [];
      return "Emergency lighting test on." + (k.length ? `\nAlready on, will stay on: ${names(k)}` : "");
    });
  }

  // One tap, except after a real emergency ran during the test (HA's own
  // power-failure automation): then a second tap within 3 s confirms.
  _emergencyForceOff(){
    const ran = (this.state._emerg && this.state._emerg.emergency_ran) || [];
    if(ran.length && !this._emergArmed()){
      this._emergArmUntil = Date.now() + 3000;
      this._toast(`${ran.join(", ")} ran during the test.\nTap again to turn off every emergency light`, true, 3000);
      clearTimeout(this._emergArmTimer);
      this._emergArmTimer = setTimeout(()=>{ this._emergArmUntil = 0; this._render(); }, 3000);
      this._render();
      return;
    }
    this._emergArmUntil = 0;
    clearTimeout(this._emergArmTimer);
    this._emergencyCall({ type:"padspan_ha/emergency_force_off" }, ()=>"Emergency lights off.", true);
  }

  _emergArmed(){ return (this._emergArmUntil || 0) > Date.now(); }

  // The floating button: a red centre (start/end the test) inside a ring of
  // its own (the card of every emergency light), the notch on the ring
  // marking it as the list.
  _emergencyOverlay(){
    const s = this.state._emerg;
    if(!s || !s.available) return null;
    // Settings → UI Structure → "Show the Test emergency lighting button".
    // Hidden only while idle: a test running (started here or elsewhere)
    // always shows, so it can be seen and ended.
    if(this.state._emergButtonHidden && !(s.test && s.test.active)) return null;
    const active = !!(s.test && s.test.active);
    const busy = !!this._emergBusy;
    const name = {};
    for(const m of s.members || []) name[m.entity_id] = m.name || m.entity_id;
    const kept = ((s.test && s.test.kept_on) || []).map(e=>name[e]||e).join(", ");
    const title = busy ? "Switching the emergency lights…" : active
      ? "Emergency lighting test on — tap to end" + (kept ? `\nAlready on, will stay on: ${kept}` : "")
      : "Test emergency lighting";
    const icon = el("span",{class:"lv-emerg-icon"});
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18v-5a5 5 0 0 1 10 0v5"/>'
      + '<path d="M5 18h14v3H5z"/><path d="M12 2v2M4.9 5.4l1.4 1.4M19.1 5.4l-1.4 1.4M2 12h2M20 12h2"/></svg>';
    const notch = el("span",{class:"lv-emerg-notch"});
    notch.innerHTML = '<svg viewBox="0 0 10 10" width="10" height="10" stroke="currentColor" stroke-width="1.6" '
      + 'stroke-linecap="round" aria-hidden="true"><path d="M2 2.5h6M2 5h6M2 7.5h6"/></svg>';
    const ring = el("button",{
      class: "lv-emerg-ring", title: "Emergency lights — list and controls", "aria-label": "Emergency lights: list and controls",
      // The card is rebuilt every poll: keep the pulse's phase continuous.
      style: active ? `animation-delay:-${(Date.now() % 1600) / 1000}s` : null,
      onclick: ()=>this._openEmergencyCard(),
    },[notch]);
    const centre = el("button",{
      class: "lv-emerg-btn", title, "aria-label": title, "aria-pressed": active ? "true" : "false",
      "aria-busy": busy ? "true" : null,
      onclick: ()=>this._emergencyToggle(),
    },[icon]);
    // The label: an icon alone on a narrow map (styles.css), so Force off
    // never slides under the rail.
    const labelText = busy ? "Switching…" : active ? "Test on — tap to end" : "Test emergency lighting";
    const labelIcon = el("span",{class:"lv-emerg-label-ic", "aria-hidden":"true"});
    if(busy) labelIcon.textContent = "…";
    else labelIcon.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">'
      + '<rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';
    const shown = active || busy;
    const kids = [
      el("div",{class:"lv-emerg-dial" + (active ? " on" : "")},[ring, centre]),
      el("button",{class:"lv-emerg-label" + (shown ? " on" : ""), tabindex: shown ? null : "-1",
        "aria-hidden": shown ? null : "true", "aria-label": labelText, title: labelText,
        onclick: ()=>this._emergencyToggle()},
        [labelIcon, el("span",{class:"lv-emerg-label-tx"}, labelText)]),
    ];
    const armed = this._emergArmed();
    if(active) kids.push(el("button",{
      class: "lv-emerg-force" + (armed ? " armed" : ""),
      title: armed ? "Tap again to turn off every emergency light"
        : "Turn off every emergency light, including the ones that were already on",
      onclick: ()=>this._emergencyForceOff(),
    }, armed ? "Tap again" : "Force off"));
    return el("div",{class:"lv-emerg-anchor"},[el("div",{class:"lv-emerg" + (busy ? " busy" : ""),
      "aria-busy": busy ? "true" : null},kids)]);
  }

  // The card behind the ring: every emergency light, its state and tags, a
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
    const close = ()=>{ try{ document.body.removeChild(overlay); }catch(_){} this._emergCard = null; };
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
        !!this._emergBusy, this._emergArmed()]);
    };
    const act = "font-size:12px;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;min-height:34px;"
      + "background:rgba(255,255,255,.03);border:1px solid rgba(252,165,165,.3);color:rgba(254,226,226,.85)";
    const chip = (text, style)=>el("span",{style:"display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;"
      + "font-size:10px;font-weight:700;letter-spacing:.04em;white-space:nowrap;" + style}, text);
    const fill = ()=>{
      const s = this.state._emerg;
      if(!s || !s.available){ close(); return; }
      shown = shows();
      const t = s.test || {};
      const active = !!t.active;
      const busy = !!this._emergBusy;
      const armed = this._emergArmed();
      const states = (this._hass && this._hass.states) || {};
      const groupNames = (s.groups || []).map(g=>(states[g] && states[g].attributes && states[g].attributes.friendly_name) || g);
      const from = s.source === "group" ? `From ${groupNames.join(" and ")}`
        : s.source === "settings" ? "From the emergency lights setting"
        : "WLED lights named Emergency";
      while(sheet.firstChild) sheet.removeChild(sheet.firstChild);
      sheet.appendChild(el("div",{style:"display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px"},[
        el("div",{},[
          el("div",{style:"font-weight:800;font-size:16px;letter-spacing:-.01em"},"Emergency lights"),
          el("div",{style:"font-size:11.5px;color:rgba(226,240,232,.5);margin-top:2px"}, from),
        ]),
        el("button",{style:act, title:"Close", onclick:close},"✕"),
      ]));
      const dim = busy ? ";opacity:.55;cursor:progress" : "";
      sheet.appendChild(el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px",
        "aria-busy": busy ? "true" : null},[
        el("button",{style: act + (active ? ";background:#7f1d1d;border-color:#dc2626;color:#fff" : "") + dim,
          onclick:()=>this._emergencyToggle()}, active ? "End test" : "Start test"),
        ...(active ? [el("button",{style: act + (armed ? ";background:#dc2626;border-color:#fecaca;color:#fff" : "") + dim,
          title: armed ? "Tap again to turn off every emergency light"
            : "Turn off every emergency light, including the ones that were already on",
          onclick:()=>this._emergencyForceOff()}, armed ? "Tap again" : "Force off")] : []),
        ...(busy ? [el("span",{style:"font-size:11.5px;color:rgba(254,226,226,.75)"},"Switching…")] : []),
      ]));
      for(const m of s.members || []){
        const st = states[m.entity_id] ? states[m.entity_id].state : m.state;
        const on = st === "on";
        const dead = st === "unavailable" || st === "missing" || st === undefined;
        const tags = [];
        if(active && (t.kept_on || []).includes(m.entity_id)) tags.push(chip("was on", "color:#fde68a;border:1px solid rgba(251,191,36,.45)"));
        if(active && (t.manual || []).includes(m.entity_id)) tags.push(chip("set here", "color:#bfdbfe;border:1px solid rgba(96,165,250,.45)"));
        const row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(252,165,165,.1)"},[
          el("span",{style:"flex:1;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis"}, m.name || m.entity_id),
          ...tags,
          chip(dead ? "Unavailable" : on ? "On" : "Off",
            dead ? "color:rgba(226,240,232,.4);border:1px dashed rgba(226,240,232,.25)"
              : on ? "color:#111827;background:#fbbf24;border:1px solid #fbbf24"
              : "color:rgba(226,240,232,.55);border:1px solid rgba(226,240,232,.2)"),
          // Fixed widths, and a blank where a row has no "⋯", so the state
          // chips and buttons line up down the list.
          el("button",{style: act + ";min-width:82px" + (dead ? ";opacity:.4;cursor:default" : dim),
            disabled: dead ? "" : null,
            onclick:()=>this._emergencyCall({ type:"padspan_ha/emergency_member", entity_id:m.entity_id, on:!on }, ()=>null)},
            on ? "Turn off" : "Turn on"),
          ...(m.entity_id.startsWith("light.") && !dead ? [el("button",{style: act + ";padding:6px 0;width:38px", title:"Brightness, colour and effects",
            onclick:()=>{
              // Adjusting a light during a test counts as setting it by hand.
              if(active) this._hass.callWS({ type:"padspan_ha/emergency_member", entity_id:m.entity_id })
                .then(r=>{ this._emergApply(r); }).catch(()=>{});
              close();
              this._openWledDetail(m.entity_id);
            }},"⋯")] : [el("span",{style:"width:38px;flex:none", "aria-hidden":"true"})]),
        ]);
        sheet.appendChild(row);
      }
      sheet.appendChild(el("div",{style:"font-size:11px;color:rgba(226,240,232,.5);line-height:1.5;margin-top:10px"},
        active ? "When the test ends, lights marked “was on” stay on and lights marked “set here” stay as you set them. Force off turns every one off."
          : "Start test turns every emergency light on. Lights already on stay on when it ends."));
    };
    const refresh = ()=>{ if(!down && shows() !== shown) fill(); };
    this._emergCard = { fill, close, refresh, sheet, overlay };
    fill();
    document.body.appendChild(overlay);
  }

  async _saveSettings(){
    try{
      // Never bundle data_mode: the backend leaves it untouched when the
      // message omits it, and echoing "live" here would make Save view flip
      // a sample-mode install to live as a hidden side effect (same reason
      // panel.js's settingsSet omits it).
      await this._hass.callWS({
        type:                    "padspan_ha/settings_set",
        overview_iso_floor_gap:  this._view.floorGap,
        overview_iso_horiz_gap:  this._view.horizGap,
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
      const g=this.shadowRoot && this.shadowRoot.querySelector(`.lhex[data-eid="${String(eid).replace(/"/g,'\\"')}"]`);
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
      onEdit: this._isAdmin() ? (e)=>this._gotoBuilder(e) : null,
      ...controlApiFor(this._regStore?.reg, eid, { tier: this.state._tier, isAdmin: this._isAdmin() }),
    });
  }

  _isAdmin(){ return !!(this._hass && this._hass.user && this._hass.user.is_admin); }
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
        this._hass.callWS({ type: "padspan_ha/flood_reset", entity_id: eid })
          .then(()=>this._render())
          .catch((e)=>this._toast("Could not reset: " + String(e), true));
      },
    };
    api.openRoom=(room, onlyEids)=>openRoomSheet(api, lights, room, onlyEids);
    api.openFloor=(z)=>openFloorSheet(api, lights, this.state.model, z);
    return api;
  }

  _render(){
    if(!this.shadowRoot) return;
    const $c=this.shadowRoot.querySelector("#content");
    if(!$c) return;
    while($c.firstChild) $c.removeChild($c.firstChild);
    $c.appendChild(this._buildUI());
    if(this._emergCard) this._emergCard.refresh();
  }

  _buildUI(){
    const root=el("div",{});

    // ── Header ────────────────────────────────────────────────────────────────
    // The lv- vocabulary from styles.css (loaded in this shadow root), so the
    // sidebar and the Mapping tab wear the same face.
    root.appendChild(el("div",{class:"lv-hero"},[
      el("div",{class:"lv-hero-title"},"Atlas"),
      el("span",{class:"lv-ver"},`v${APP_VERSION}`),
      el("span",{class:"lv-hint"},"Tap a light to switch it \u00b7 tap its code or hold for controls \u00b7 tap a room name for the whole room \u00b7 motion, temperature and air-quality tiles are read-only"),
      // Admin only: the pencil to the builder. Same map, the other tool.
      ...(this._isAdmin() ? [el("button",{class:"lv-act",style:"margin-left:auto",title:"Open Mapping \u2192 Atlas",
        onclick:()=>this._gotoBuilder(null)},"\u270e Edit map")] : []),
      el("button",{class:"lv-act",style:this._isAdmin()?"":"margin-left:auto",onclick:()=>{
        this._regStore.reg=null; this._boot().then(()=>this._render());
      }},"\u21bb Refresh"),
    ]));
    // One-time coach mark. Dismissed once per browser; never again.
    if(!this.state._coachSeen){
      root.appendChild(el("div",{class:"lv-coach"},[
        el("span",{},"\u{1F4A1} Tap a light to switch it. Tap its code, or press and hold, for brightness, colour, effects and fan speed. Hold a dimmable light and slide up or down to dim it. Tap a room name for everything in the room. Motion, temperature and air-quality tiles are read-only — they just show what's happening."),
        el("button",{class:"lv-act",onclick:()=>{
          this.state._coachSeen=true;
          try{ localStorage.setItem(LS_COACH,"1"); }catch(_){}
          this._render();
        }},"Got it"),
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
    const lights = gatherLights(this._hass?.states||{}, reg.areaMap, this.state._shapeOverrides, this.state._tier, reg.platformMap, this.state._typeOverrides, reg.pairMap, reg.manufacturerMap, undefined, false, this.state._motionReconnects);

    if(!lights.length){
      root.appendChild(el("div",{class:"muted",style:"padding:8px"},"No light entities found."));
      return root;
    }
    const lightsByEid={};
    for(const l of lights) lightsByEid[l.entity_id]=l;

    // Group by room (hidden excluded from map)
    const hidden=this.state._hidden;
    const byRoom={};
    for(const l of lights){
      if(l.area_name && !hidden.has(l.entity_id))
        (byRoom[l.area_name]=byRoom[l.area_name]||[]).push(l);
    }

    // ── The shared map card — identical map to the Mapping → Lights tab ──────
    const floors=this.state.model.floors||[];
    // Door/window/lock click-to-control (Garry, 2026-09-22) — same gate as
    // maps.js's own barrierHit (_isPro there): Bright or Pro, never free.
    const paid=["bright","pro"].includes(String(this.state._tier||"").toLowerCase());

    const host={
      el,
      floors,
      model: this.state.model,
      tier: this.state._tier,
      barrierHit: paid,
      byRoom,
      hiddenEids: hidden,
      // This screen IS the house map (Garry, 2026-09-21: "anything to the
      // sides is a distraction from the purpose of the screen") — v2's
      // display variant: edge-to-edge map, a slim icon rail, every bar a
      // drawer over the map. No onLayoutV2: the toggle lives in the
      // builder only, this panel just reflects what it's set to.
      // Gated to Pro specifically (Garry, 2026-09-23) — same split as the
      // builder's own proTier, not the bright-or-pro `paid` above.
      layoutV2: String(this.state._tier||"").toLowerCase()==="pro" && !!this.state._atlasLayoutV2,
      displayMode: true,
      showcase: !!this.state._showcase,
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
      // Quick-apply only (Garry, 2026-09-11: "a small preset button in the
      // lights tab for quick changes") — no onSavePreset/onDeletePreset, so
      // the shared preset bar renders Apply alone. Saving/deleting a look
      // stays an editing action for Mapping -> Lights, same line as the
      // read-only modes above.
      showcasePresets: this.state._showcasePresets || [],
      // Whole House Presets — quick-apply from the sidebar, same as the
      // Showcase presets above (Garry, 2026-09-11 precedent: no edit UI in
      // the everyday panel, editing stays in Mapping -> Lights). Set/Delete
      // are included too, since this is the panel someone reaches for on a
      // wall kiosk without opening the full builder.
      wholeHousePresets: this.state._wholeHousePresets || [],
      onWholeHouseSet: async (name) => {
        const lights = Object.values(this.state.lightsByEid || {});
        const cap = captureWholeHouse(lights, this._hass?.states || {});
        const rest = (this.state._wholeHousePresets || []).filter((p) => p.name !== name);
        const preset = { name, created_at: Date.now() / 1000, entities: cap.entities };
        try { await this._hass.callWS({ type: "padspan_ha/settings_set", whole_house_presets: [...rest, preset] }); }
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
        try { await this._hass.callWS({ type: "padspan_ha/settings_set", whole_house_presets: rest }); }
        catch (e) { return; }
        this.state._wholeHousePresets = rest;
        this._render();
      },
      // Vacation Mode's own "permanent option" — quick-apply from the
      // sidebar too, same as any other Whole House Preset here. The banner
      // itself (Disable + intensity slider), pinned dead-center of the
      // screen, is built into the shared card below (Garry, 2026-09-21:
      // "I wanted the banner to show in the two atlas screens" — this one
      // and Mapping -> Atlas, nowhere else, so it lives in the shared
      // renderer rather than panel.js's global chrome).
      onVacationModeEnable: async () => {
        if (!this._hass) return false;
        try { await this._hass.callWS({ type: "padspan_ha/settings_set", vacation_mode_enabled: true }); }
        catch (e) { return false; }
        this.state._vacationModeEnabled = true;
        this._render();
        return true;
      },
      vacationModeEnabled: !!this.state._vacationModeEnabled,
      vacationModeIntensity: this.state._vacationModeIntensity || 100,
      onVacationModeDisable: async () => {
        if (!this._hass) return false;
        try { await this._hass.callWS({ type: "padspan_ha/settings_set", vacation_mode_enabled: false }); }
        catch (e) { this._toast("Could not disable Vacation Mode: " + String(e), true); return false; }
        this.state._vacationModeEnabled = false;
        this._render();
        return true;
      },
      onVacationModeIntensity: async (pct) => {
        this.state._vacationModeIntensity = pct;
        try { await this._hass.callWS({ type: "padspan_ha/settings_set", vacation_mode_intensity: pct }); }
        catch (e) { this._toast("Could not change the intensity: " + String(e), true); }
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
        if (values.overview_iso_floor_gap !== undefined) this._view.floorGap = values.overview_iso_floor_gap;
        if (values.overview_iso_horiz_gap !== undefined) this._view.horizGap = values.overview_iso_horiz_gap;
        if (values.overview_iso_focus !== undefined) this._view.focusIdx = values.overview_iso_focus ?? 0;
        if (values.overview_iso_zoom !== undefined) this._view.zoom = values.overview_iso_zoom;
        try { await this._hass.callWS({ type: "padspan_ha/settings_set", ...values }); }
        catch (e) { this._toast("Could not apply the preset: " + String(e), true); }
        this._render();
      },
      // Same read-only reflection as the modes above — no onHideDeviceCodes,
      // this panel never edits it, only displays what Mapping -> Lights set.
      hideDeviceCodes: !!this.state._hideDeviceCodes,
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
          Promise.resolve(this._hass.callWS({ type:"padspan_ha/telemetry_event", event:String(name) })).catch(()=>{});
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
        // The 3D compass's Save: the GPS Bridge's own bearing,
        // fabric_bearing_deg, written alone and kept here at once.
        saveNorth: async (b)=>{
          const r = await this._hass.callWS({ type:"padspan_ha/settings_set", fabric_bearing_deg: b });
          const v = Number(r && r.settings && r.settings.fabric_bearing_deg);
          this.state._house3d = { ...(this.state._house3d || {}), fabric_bearing_deg: Number.isFinite(v) ? v : b };
          return true;
        },
        // Taps and holds in 3D: this map's own use api, asked for on the press.
        useApi: ()=>this._useApi(lightsByEid, lights),
        // Furniture that is a device (P5): renames followed through the
        // registry already read above, and the emergency lights while a
        // test runs (the status this panel already keeps).
        entities: this._hass?.entities || null, regIds: this._regStore?.reg?.regIds || null,
        // Show people (P6): this panel has no live snapshot of its own, so
        // the 3D view reads Overview's through here, only while Show people
        // is on and the view shows, never more often than Overview polls.
        people: { read: ()=>this._hass.callWS({ type:"padspan_ha/live_snapshot" }).then(r=>(r && r.snapshot) || null),
          everyMs: 1000 * (Number(this.state._house3d.presence_poll_interval_s) || 5) },
        emergency: this.state._emerg && this.state._emerg.test && this.state._emerg.test.active
          ? (this.state._emerg.members || []).map(m => m && m.entity_id).filter(Boolean) : null,
        // The 3D file (doors and windows drawn in 3D, heights): read when
        // the 3D view shows, never on the poll.
        load: ()=>this._hass.callWS({ type:"padspan_ha/house3d_get" }),
        telemetry: (name)=>{
          if(!this.state._telemetryOn || !this._hass) return;
          Promise.resolve(this._hass.callWS({ type:"padspan_ha/telemetry_event", event:String(name) })).catch(()=>{});
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
      saveView: ()=>this._saveSettings(),
      callWS: (msg)=>this._hass.callWS(msg),
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
      onClassFilter: (cls)=>{
        this.state._classFilter=cls;
        try{ localStorage.setItem(LS_CLASS, cls); }catch(_){}
        this._render();
      },
      onHexesBuilt: (isoDiv)=>{
        requestAnimationFrame(()=>{
          const api = this._useApi(lightsByEid, lights);
          wireUseSurface(isoDiv, api);
          // The same hover HUD the builder has (Garry, 2026-09-14: "the mouse
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
              else api.toggle(eid);
            },
            underTitle: "Act on this one instead — it's under the marker on top",
            stackHint: null,
            roomLine: (room, n) => `${room} — opens its ${n} device${n === 1 ? "" : "s"}`,
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
      // already do. Pro only, matching the Mapping tab's own gate.
      typeOverrides: this.state._typeOverrides,
      onTypeOverride: String(this.state._tier||"").toLowerCase()==="pro" ? async (eid, kind) => {
        const next = { ...this.state._typeOverrides };
        if (!kind || kind === "auto") delete next[eid]; else next[eid] = kind;
        this.state._typeOverrides = next;
        try { await this._hass.callWS({ type: "padspan_ha/settings_set", light_type_overrides: next }); }
        catch (e) { this._toast("Could not save the type override: " + String(e), true); }
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
      floodLatches: this.state._floodLatches || {},
      onFloodReset: (eid)=>{
        this._hass.callWS({ type: "padspan_ha/flood_reset", entity_id: eid })
          .then(()=>this._render())
          .catch((e)=>this._toast("Could not reset: " + String(e), true));
      },
    };

    const mapCard=buildLightsMapCard(host);
    root.appendChild(mapCard);
    // "Test emergency lighting" floats over the map's TOP-right corner (the
    // map's top is on screen when the Atlas opens; its bottom often is not):
    // a zero-height anchor right before the stage, so nothing moves.
    const emerg=this._emergencyOverlay();
    const stage=emerg && mapCard.querySelector(".lv-stage");
    if(stage) stage.parentNode.insertBefore(emerg, stage);

    // ── The 90-day trial, under the free map it would unlock ──────────────────
    if(!paid){
      const trial=this._trialCard();
      if(trial) root.appendChild(trial);
    }

    // ── Unassigned notice + light index table (shared with the Mapping tab) ──
    root.appendChild(buildLightsTable(host, lights));

    return root;
  }

  // The trial card (views/trial_offer.js) with this panel as its host. Null
  // when hidden on this browser, or when there is nothing to offer.
  _trialCard(){
    if(this.state._trialHidden) return null;
    return trialOfferCard({
      el,
      settings: this.state._trialSettings,
      isAdmin: this._isAdmin(),
      callWS: (type, data)=>this._hass.callWS({ type, ...(data||{}) }),
      telemetry: (name)=>{
        if(!this.state._telemetryOn) return;
        this._hass.callWS({ type:"padspan_ha/telemetry_event", event:String(name) }).catch(()=>{});
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

  _toast(msg, isError=false, durationMs=null){
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
    if(this._toastEl){ try{ document.body.removeChild(this._toastEl); }catch(_){} }
    this._toastEl = t;
    document.body.appendChild(t);
    // Long enough to read: the emergency messages run to a few sentences.
    // A message tied to a window (Force off's "tap again") passes its own.
    const ms = durationMs || Math.min(10000, Math.max(3500, String(msg).length * 60));
    setTimeout(()=>{ try{document.body.removeChild(t);}catch(_){} if(this._toastEl === t) this._toastEl = null; }, ms);
  }

  connectedCallback(){
    if(!this.shadowRoot) this.attachShadow({mode:"open"});
    this._shownAt = Date.now();
    // Track a held pointer so the 5s poll can't re-render mid-interaction
    // (dragging a slider is the case that actually bites).
    if(!this._pointerWired){
      this._pointerWired = true;
      this.addEventListener("pointerdown", ()=>{ this._pointerDown = true; });
      window.addEventListener("pointerup", ()=>{ this._pointerDown = false; });
      window.addEventListener("pointercancel", ()=>{ this._pointerDown = false; });
    }
    // Uncaught errors with PadSpan code on the stack, counted for the opt-in
    // report as ui_error:<module> + ui_error_while:atlas. The backend drops
    // the event unless the report is switched on.
    if(!this._uiErrorHandler){
      this._uiErrorHandler = (ev)=>{
        try{
          if(!UI_ERROR || !this._hass) return;
          UI_ERROR.reportUiError(ev, "atlas", (name)=>{
            Promise.resolve(this._hass.callWS({ type:"padspan_ha/telemetry_event", event:name })).catch(()=>{});
          });
        }catch(_e){ /* the error reporter must never be the error */ }
      };
      window.addEventListener("error", this._uiErrorHandler);
      window.addEventListener("unhandledrejection", this._uiErrorHandler);
    }
    this.style.display="block";
    this.shadowRoot.innerHTML=`
      <link rel="stylesheet" href="/padspan_ha_static/padspan-ha/styles.css?v=${APP_VERSION}&b=${BUILD_ID}">
      <style>
        :host{display:block;min-height:100vh;background:#0a150e;color:#e2e8f0;
              font-family:Inter,system-ui,Arial,sans-serif;box-sizing:border-box}
        #content{padding:16px}
      </style>
      <div id="content"></div>
    `;
    if(this._booted) this._render();
  }

  disconnectedCallback(){
    if(this._pollTimer){ clearInterval(this._pollTimer); this._pollTimer=null; }
    if(this._uiErrorHandler){
      window.removeEventListener("error", this._uiErrorHandler);
      window.removeEventListener("unhandledrejection", this._uiErrorHandler);
      this._uiErrorHandler = null;
    }
    if(this._reconnectsStop) this._reconnectsStop();
    this._reconnectsStop = null; this._reconnectsConn = null;
    if(this._emergCard) this._emergCard.close();
    clearTimeout(this._emergArmTimer);
  }
}

// Guard against duplicate definition when a stale module lingers alongside a
// freshly-registered one after an integration reload (see panel.js for detail).
if (!customElements.get("padspan-lights-app")) {
  customElements.define("padspan-lights-app", PadSpanLightsApp);
}
