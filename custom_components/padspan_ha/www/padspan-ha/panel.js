// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/*
REPO LOGIC NOTES

PadSpan HA Panel (single sidebar entry).
- All backend calls go through hass.callWS (websocket_api).
- The UI supports Sample vs Live data (toggle top-right).
- Internal navigation renders feature pages. Each page module exports render(ctx).
- A build stamp is shown in the UI so you can *prove* what code HA is serving (avoids cache confusion).

If UI changes don't show:
  - Hard refresh browser (Ctrl+F5)
  - Clear cache for your HA URL
  - Confirm build stamp in Diagnostics page
*/

// ── Version & Build Constants ────────────────────────────────────────────────
// APP_VERSION is the semver shown in the sidebar and Diagnostics.
// BUILD_ID (YYYYMMDDTHHMMSSZ) is appended to all JS import URLs as a cache-buster
// so browsers always load the latest code after a release.
// CHANNEL controls the sidebar badge and maps to GitHub release types (beta=pre-release).
const APP_VERSION = "0.36.3";
const RELEASE_BUILD_ID = "20260816T234608Z";
// The stamp the views are actually loaded with.
//
// This was the release literal above, so every view URL stayed frozen between
// releases — a browser kept serving `overview.js?b=<last release>` however
// many times that file changed on disk. panel.py now stamps OUR url with a
// digest of the frontend tree (build_info.ASSET_ID), so reading it back here
// makes every view inherit a stamp that moves whenever a file does. The
// literal remains the fallback for anything that loads this module directly.
const BUILD_ID = (() => {
  try {
    return new URL(import.meta.url).searchParams.get("b") || RELEASE_BUILD_ID;
  } catch (e) {
    return RELEASE_BUILD_ID;
  }
})();
const CHANNEL = "beta";

// ── Editions and tiers ───────────────────────────────────────────────────────
// Which surfaces this build shows (views/editions.js). Loaded with the same
// cache-buster as everything else; a failure here must not take the panel
// down, so the fallback is "show everything" — the full edition's answer.
let EDITIONS = null;
const _editionsPromise = import(`./views/editions.js?b=${BUILD_ID}`)
  .then(m => { EDITIONS = m; })
  .catch(err => console.warn("PadSpan: editions module failed to load", err));

// ── Dynamic view imports ─────────────────────────────────────────────────────
// Two-phase loading for fast first paint:
//   Phase 1 (critical): sample_data, help_content, overview, follow — enough to
//                        render the default view immediately.
//   Phase 2 (deferred): remaining views load in background after first render.
// On-demand: if the user navigates to a view that hasn't loaded yet,
// _loadView() fetches it immediately and re-renders.
let SAMPLE_SNAPSHOT = null;
let HELP = {};
const VIEWS = {};
// Expose VIEWS globally so the Preact bridge can access loaded view modules
window.__PADSPAN_VIEWS = VIEWS;

// Map of view id → module path for on-demand loading
const _VIEW_PATHS = {
  follow:       "./views/follow.js",
  overview:     "./views/overview.js",
  purelive: "./views/purelive.js",
  objects:      "./views/objects.js",
  devices:      "./views/devices.js",
  bluetooth:    "./views/bluetooth.js",
  presence:     "./views/presence.js",
  history:      "./views/history.js",
  monitor:      "./views/monitor.js",
  maps:         "./views/maps.js",
  events:       "./views/events.js",
  health:       "./views/health.js",
  settings:     "./views/settings.js",
  manage:       "./views/manage.js",
  debug:        "./views/debug.js",
  diagnostics:  "./views/diagnostics.js",
  qa:           "./views/qa.js",
  training:     "./views/training.js",
  calibration:  "./views/calibration.js",
  traceback:    "./views/traceback.js",
  forensics:    "./views/forensics.js",
  sandbox:      "./views/sandbox.js",
  occupancy:    "./views/occupancy.js",
};

// Views reachable by internal navigation but never listed in MENU. Being
// current while not in the visible menu set is legitimate for these.
const _VIEW_PATHS_HIDDEN_OK = new Set(["objects", "history", "events", "debug", "diagnostics"]);

// Track in-flight imports to avoid duplicate fetches
const _viewLoading = {};

/** Load a single view on demand. Returns a promise that resolves when ready. */
function _loadView(id) {
  if (VIEWS[id]) return Promise.resolve(VIEWS[id]);
  if (_viewLoading[id]) return _viewLoading[id];
  const path = _VIEW_PATHS[id];
  if (!path) return Promise.resolve(null);
  _viewLoading[id] = import(`${path}?b=${BUILD_ID}`)
    .then(m => { VIEWS[id] = m; delete _viewLoading[id]; return m; })
    .catch(err => { console.warn("PadSpan: failed to load view", id, err); delete _viewLoading[id]; return null; });
  return _viewLoading[id];
}

// Phase 1: critical modules — just enough for the default view
const _criticalPromise = Promise.allSettled([
  import(`./sample_data.js?b=${BUILD_ID}`).then(m => { SAMPLE_SNAPSHOT = m.SAMPLE_SNAPSHOT || null; }),
  import(`./help_content.js?b=${BUILD_ID}`).then(m => { HELP = m.HELP || {}; }),
  import(`./views/overview.js?b=${BUILD_ID}`).then(m => { VIEWS.overview = m; }),
  import(`./views/follow.js?b=${BUILD_ID}`).then(m => { VIEWS.follow = m; }),
]).then(results => {
  results.forEach((r, i) => {
    if(r.status === "rejected") console.warn("PadSpan: critical module [" + i + "] failed to load:", r.reason);
  });
});

// Phase 2: remaining views — loaded in background after first paint
const _deferredViewIds = Object.keys(_VIEW_PATHS).filter(id => id !== "overview" && id !== "follow");
let _deferredStarted = false;
function _startDeferredLoads() {
  if (_deferredStarted) return;
  _deferredStarted = true;
  // Stagger slightly to avoid hammering the network on slow hardware
  Promise.allSettled(
    _deferredViewIds.map(id =>
      import(`${_VIEW_PATHS[id]}?b=${BUILD_ID}`)
        .then(m => { VIEWS[id] = m; })
        .catch(err => console.warn("PadSpan: deferred view", id, "failed:", err))
    )
  );
}

// Backwards compat: anything that awaits _viewsPromise still works
const _viewsPromise = _criticalPromise;

// ── Sidebar Menu Definition ──────────────────────────────────────────────────
// Each entry: [route_id, display_label, mdi_icon].
// Order here determines sidebar rendering order. Visibility is filtered
// at render time based on the current complexity mode (Basic/Advanced/Dev).
const MENU = [
  ["overview","Overview","mdi:view-dashboard-outline"],
  ["purelive","Pure Live","mdi:lightning-bolt-outline"],
  ["follow","Follow","mdi:crosshairs-gps"],
  ["devices","Devices","mdi:devices"],
  ["bluetooth","Bluetooth","mdi:bluetooth"],
  ["presence","Presence","mdi:map-marker-radius-outline"],
  ["monitor","Monitor","mdi:monitor-dashboard"],
  ["maps","Mapping","mdi:map"],
  ["settings","Settings","mdi:cog-outline"],
  ["manage","Manage","mdi:cog-wrench"],
  ["training","Training","mdi:school-outline"],
  ["calibration","Calibration","mdi:crosshairs"],
  ["traceback","Traceback","mdi:history"],
  ["forensics","Forensics","mdi:magnify-scan"],
  ["occupancy","Occupancy","mdi:account-group-outline"],
  ["health","Health","mdi:heart-pulse"],
  ["qa","QA","mdi:clipboard-check-outline"],
  ["sandbox","Sandbox","mdi:flask-outline"],
];

// ── Complexity Mode Tab Sets ─────────────────────────────────────────────────
// Three complexity tiers control which sidebar tabs are visible:
//   Basic     — simplified for non-technical users (follow + overview + essentials)
//   Advanced  — default set plus user-chosen extras from Settings -> UI Structure
//   Dev       — everything visible (includes QA, Sandbox, raw Debug, etc.)
const BASIC_TABS = new Set(["follow", "overview", "maps", "settings", "training"]);
const ADVANCED_DEFAULT = new Set(["follow","overview","purelive","maps","settings","training","manage","calibration","traceback","occupancy","health"]);
const DEV_ONLY_TABS = ["devices","bluetooth","presence","monitor","qa","sandbox"];

// Accent color per tab — used for the sidebar dot, mobile nav, and active highlights
const MENU_COLORS = {
  follow: "#5eead4",
  overview: "#52b788",
  objects: "#ff8a65",
  devices: "#4db6ac",
  bluetooth: "#43a047",
  presence: "#ba68c8",
  zones: "#81c784",
  insights: "#ffd54f",
  history: "#90a4ae",
  monitor: "#f06292",
  maps: "#4caf50",
  events: "#ffb74d",
  health: "#e57373",
  settings: "#b0bec5",
  manage: "#78909c",
  training: "#4dd0e1",
  calibration: "#26a69a",
  occupancy: "#a78bfa",
  diagnostics: "#9575cd",
  debug: "#ef5350",
  traceback: "#fbbf24",
  forensics: "#f87171",
  qa: "#26c6da",
  sandbox: "#9ccc65",
  purelive: "#7c3aed",
};

// ── 2025 skin: nav icons and groups ──────────────────────────────────────────
// MENU already carries an mdi name per entry, but nothing ever rendered it —
// which is also why the collapsed rail (.app.mini) had nothing to fall back to
// and clipped its labels mid-word. These are inline SVG bodies rather than
// <ha-icon>: ha-icon is used nowhere else in this panel, and a missing
// registration inside a shadow root renders as a blank box. Inline SVG also
// inherits currentColor, which is what drives the active-state tint.
// Only consulted when settings.ui_skin === "2025".
const MENU_ICONS = {
  overview:    '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  purelive:    '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  follow:      '<path d="M21 3 3 10.5l7.5 3L14 21l7-18z"/>',
  occupancy:   '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M16 5.6a3.2 3.2 0 0 1 0 6.1M17.2 20c0-2.6-.9-4.2-2.4-5"/>',
  maps:        '<path d="M9 4 3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5 9 4z"/><path d="M9 4v14M15 6.5v14"/>',
  calibration: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.6"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  training:    '<path d="M12 4 2 9l10 5 10-5-10-5z"/><path d="M6 11.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5"/>',
  manage:      '<path d="M4 6h9M19 6h1M4 12h4M13 12h7M4 18h9M19 18h1"/><circle cx="16" cy="6" r="2.1"/><circle cx="10.5" cy="12" r="2.1"/><circle cx="16" cy="18" r="2.1"/>',
  settings:    '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.2v2.6M12 19.2v2.6M4.4 4.4l1.9 1.9M17.7 17.7l1.9 1.9M2.2 12h2.6M19.2 12h2.6M4.4 19.6l1.9-1.9M17.7 6.3l1.9-1.9"/>',
  traceback:   '<path d="M3.2 12a8.8 8.8 0 1 0 2.9-6.5L3 8"/><path d="M3 3v5h5"/><path d="M12 7.4V12l3 2"/>',
  health:      '<path d="M12 20s-7.4-4.9-7.4-9.4A4.1 4.1 0 0 1 12 7.5a4.1 4.1 0 0 1 7.4 3.1c0 4.5-7.4 9.4-7.4 9.4z"/><path d="M4.8 12.1h2.9l1.4-2.1 1.8 3.9 1.6-2.9 1.1 1.1h4.6"/>',
  forensics:   '<circle cx="11" cy="11" r="6.2"/><path d="M20 20l-4.6-4.6"/><path d="M8.2 11h5.6"/>',
  monitor:     '<rect x="2.5" y="4" width="19" height="12.4" rx="2"/><path d="M9 20h6M12 16.4V20"/>',
  devices:     '<rect x="2" y="5" width="13" height="10" rx="1.8"/><path d="M5.5 19h6"/><rect x="17" y="9" width="5" height="10" rx="1.6"/>',
  bluetooth:   '<path d="M7 7.5 17 16.5 12 21V3l5 4.5L7 16.5"/>',
  presence:    '<circle cx="12" cy="10" r="2.5"/><path d="M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10z"/>',
  qa:          '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3.6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.9"/><path d="M9 13l2.2 2.2L15.5 11"/>',
  sandbox:     '<path d="M10 3v6.2L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 9.2V3"/><path d="M9 3h6"/><path d="M7.4 14.5h9.2"/>',
};

// Sidebar grouping for the 2025 skin. Order here drives render order; any MENU
// id missing from this table still renders, under a trailing "More" heading, so
// adding a tab without touching this file can never make it disappear.
const MENU_GROUPS = [
  ["Live",      ["overview","purelive","follow","occupancy"]],
  ["Setup",     ["maps","calibration","training","manage","settings"]],
  ["Diagnose",  ["traceback","health","forensics","monitor"]],
  ["Internals", ["devices","bluetooth","presence","qa","sandbox"]],
];


// ── DOM Utility Functions ────────────────────────────────────────────────────
// Shared helpers used by panel.js and all view modules (passed via ctx.helpers).

/** HTML-escape a string to prevent XSS when inserting into innerHTML. */
function esc(s){
  return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

/** Convenience DOM builder: el("div", {class:"foo", onclick:fn}, ["text", childNode]) */
/**
 * Human-readable age, e.g. "42s", "3m 10s", "2d 4h".
 *
 * This was a local of _showObjectDetail while _showRoomDetail called it as if
 * it were shared — a ReferenceError on every click of an occupied room, and
 * invisible because the modal simply never opened. It is shared now, which is
 * what both callers always assumed.
 */
function fmtAgo(age_s){
  const s = Number(age_s);
  if(!isFinite(s)) return "—";
  if(s < 1) return "<1s";
  if(s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s/60), rs = Math.round(s - m*60);
  if(m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m/60), rm = m - h*60;
  if(h < 24) return `${h}h ${rm}m`;
  const d = Math.floor(h/24), rh = h - d*24;
  return `${d}d ${rh}h`;
}

function el(tag, attrs={}, children=[]){
  const n=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})) {
    if(k==="class") n.className=v;
    else if(k==="id") n.id=v;
    else if(k==="style") n.setAttribute("style", v);
    else if(k.startsWith("on") && typeof v==="function") n.addEventListener(k.slice(2), v);
    else if(v!==undefined && v!==null) n.setAttribute(k, String(v));
  }
  if(!Array.isArray(children)) children=[children];
  for(const c of children) {
    if(c===null || c===undefined) continue;
    if(typeof c==="string" || typeof c==="number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}

/**
 * URL for a map's image, versioned so a stale browser cache can never serve
 * the pre-edit picture.
 *
 * The PNG is overwritten in place on trim/rotate/replace (maps_store's
 * async_replace_image), so the filename is NOT a stable identity for its
 * contents — a bare path renders the OLD image stretched into the NEW
 * dimensions, which is what a trimmed map looked like in issue #62.
 * Every map image URL must be built here; tests/test_map_image_url.py fails
 * the build if a bare path reappears.
 */
function mapImageUrl(map){
  const fn = map && map.image && map.image.filename;
  if(!fn) return null;
  const v = String((map.updated || map.image.sha256 || "")).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  return "/local/padspan_ha/maps/" + fn + (v ? "?v=" + v : "");
}

/**
 * Away timeout in SECONDS, from settings (default 5 min), and the presence
 * test that goes with it. Mirrors presence_rules.py exactly.
 *
 * This one rule had been hand-rolled in nine places across the backend and
 * frontend. Copies drift: the server-side room-occupancy rebuild never
 * implemented it at all, so a car gone for an hour stayed listed in the Garage
 * beside devices seen 20 seconds ago. Every consumer must come through here;
 * tests/test_presence_away_rule.py fails the build if a tenth copy appears.
 */
const AWAY_RADIO_KINDS = ["ble", "private_ble", "ibeacon"];
function awayTimeoutS(settings){
  const v = settings && settings.away_timeout_m != null ? Number(settings.away_timeout_m) : 5;
  if(!isFinite(v)) return 300;
  return Math.max(1, Math.min(1440, v)) * 60;
}
/** Only radio-backed objects go away; an object with no usable age never has. */
function isAway(obj, timeoutS){
  if(!obj || AWAY_RADIO_KINDS.indexOf(obj.kind) === -1) return false;
  const a = obj.age_s;
  return typeof a === "number" && isFinite(a) && a > timeoutS;
}

/**
 * Deterministic short ID for a BLE radio: letter-number-letter (e.g. "A3B").
 * Derived from a djb2 hash of the source string so it's stable across sessions
 * and compact enough to display as a visual badge in scanner lists.
 */
function radioShortId(source){
  let h = 5381;
  const s = String(source || "");
  for(let i = 0; i < s.length; i++) h = (((h * 33) >>> 0) ^ s.charCodeAt(i)) >>> 0;
  const L1 = String.fromCharCode(65 + (h % 26));
  const N  = (h >>> 5) % 10;
  const L2 = String.fromCharCode(65 + ((h >>> 9) % 26));
  return `${L1}${N}${L2}`;
}

/**
 * Determine scanner status: "scanning", "listening", or "idle".
 * @param {object} radio  — radio object with .scanning, .source
 * @param {Array}  ads    — snapshot advertisements array (optional)
 * @returns {{label:string, cls:string, title:string}}
 */
function scannerStatus(radio, ads){
  if(radio.scanning === true)
    return { label:"scanning", cls:"badge", title:"Actively requesting BLE advertisements from nearby devices" };
  // Use last_heard_s (seconds since last ad received, independent of age filter) if available
  const lh = radio.last_heard_s;
  if(typeof lh === "number" && lh < 120)
    return { label:"listening", cls:"badge", style:"background:rgba(56,189,248,.14);color:#38bdf8", title:`Last heard ${Math.round(lh)}s ago — online and receiving BLE broadcasts` };
  const src = radio.source || "";
  const hasAds = Array.isArray(ads) && ads.some(a => a.source === src);
  if(hasAds)
    return { label:"listening", cls:"badge", style:"background:rgba(56,189,248,.14);color:#38bdf8", title:"Online and receiving BLE broadcasts (passive mode)" };
  if(typeof lh === "number" && lh < 600)
    return { label:`heard ${Math.round(lh)}s ago`, cls:"badge warn", title:`Last advertisement received ${Math.round(lh)}s ago — may be in a quiet area` };
  return { label:"idle", cls:"badge warn", title:"No recent BLE data — may be offline, rebooting, or in a quiet area" };
}

// Room colour lives in views/room_color.js — ONE implementation, shared with
// the lights renderer. panel.js hands it to every view as ctx.helpers.roomColor.
const { roomColor } =
  await import(`./views/room_color.js${new URL(import.meta.url).search}`);

function pill(text){ return el("span",{class:"pill"}, text); }

// ── Main Application Element ─────────────────────────────────────────────────
// PadSpanHaApp is registered as a custom element ("padspan-ha-app") and mounted
// by Home Assistant as a panel. HA drives the lifecycle:
//   1. constructor()        — initializes state (no DOM yet)
//   2. connectedCallback()  — builds shadow DOM, starts polling & keep-alive
//   3. set hass(hass)       — called by HA on every state change (very frequent);
//                             used for first boot, WS reconnect detection, and
//                             sidebar re-entry recovery
//   4. disconnectedCallback() — tears down timers & listeners when HA detaches
//
// State management: all UI state lives in this.state (a plain object).
// Views receive a "ctx" object (_ctx()) with state, helpers, and actions.
// Views are pure render functions: ctx => HTMLElement. They never mutate state
// directly — all mutations go through ctx.actions which call back into this class.
class PadSpanHaApp extends HTMLElement {
  constructor(){
    super();
    this._hass = null;

    // ── Centralized application state ──────────────────────────────────────
    // All UI state is kept here so views can read it through ctx.state.
    // Mutations happen through actions (ctx.actions) which update state
    // and trigger re-renders via _renderCurrentView().
    this.state = {
      version: APP_VERSION,
      buildId: BUILD_ID,
      view: "overview",
      dataMode: "sample",          // sample | live
      complexity: "advanced",      // basic | advanced | development
      status: {},
      roomTagMap: {},
      savedRoomTagMap: {},
      model: { floors: [], room_meta: {}, scanners: {}, room_adjacency: {}, fabric_sync_mode: "auto", scanner_positions_m: {}, room_geometry_m: {}, rf_barriers_m: [], map_transforms: {}, beacon_positions_m: {}, fabric_floors: {} },
      live: { snapshot: null, sources: null, error: null },
      maps: { list: [], lastError: null },
      mapsTab: "library",
      activeMapId: null,
      diag: null,
      selectedRooms: [],
      _roomsInit: false,
      mode: "live",
      tagFilter: "",
      wsCounts: {},
      timing: { lastRefreshMs: null, lastDiagMs: null },
      _sessionEvents: [],
      _sessionStart: Date.now(),
      lastToast: null,
      versionInfo: null,
      settings: {},               // full settings dict from settings_get
      // Followed beacons — persisted to localStorage
      followedAddrs: new Set(JSON.parse(localStorage.getItem("padspan_followed") || "[]")),
      followAddr: localStorage.getItem("padspan_followAddr") || "",
    };

    // ── Shadow DOM references (set in connectedCallback) ─────────────────
    this.$ = null;          // querySelector shorthand for shadow DOM
    this.$nav = null;       // sidebar nav container
    this.$content = null;   // main content area where views render

    // ── Polling & Keep-Alive Timers ────────────────────────────────────────
    // _pollTimer: 5s interval that fetches live_snapshot + status (data freshness)
    // _pollInFlight: prevents overlapping WS calls if previous poll is still running
    this._pollTimer = null;
    this._pollInFlight = false;
    // _activityTimer: 25s synthetic pointer events to prevent HA idle overlay
    // _watchdogTimer: 5s DOM integrity checks to recover from blank screens
    this._activityTimer = null;
    this._watchdogTimer = null;
    // Render health tracking — watchdog uses these to detect persistent blank screens
    // and escalate from soft re-render to full connectedCallback rebuild
    this._lastGoodRender = performance.now();
    this._renderFailCount = 0;
    // Track last user interaction to suppress poll re-renders during active use
    // (prevents form inputs from being destroyed while the user is typing)
    this._lastUserInteraction = 0;

    // Custom-element upgrade race: HA can set .hass on this element before
    // the browser finishes upgrading it to this class (the defining module
    // loads async over the network), which creates a plain instance
    // property that permanently shadows the `hass` accessor below — set
    // hass() would then never fire on its own. The _watchdogTimer above
    // already recovers from this within ~5s, but reclaiming any pre-upgrade
    // value here through the accessor avoids that delay/blank flash entirely.
    if (Object.prototype.hasOwnProperty.call(this, "hass")) {
      const preUpgradeHass = this.hass;
      delete this.hass;
      this.hass = preUpgradeHass;
    }
  }

  // ── HA Property Setter ──────────────────────────────────────────────────────
  // HA calls `set hass()` on EVERY state change (entity updates, etc.) — potentially
  // dozens of times per second. We must NOT do expensive work on every call.
  // Three cases are handled:
  //   1. First boot (_booted === false): wait for view modules, then full refresh
  //   2. WS reconnect (connection object changed): re-bootstrap everything
  //   3. Sidebar re-entry: restart timers/listeners if they were cleared by disconnect
  set hass(hass){
    const prevHass = this._hass;
    this._hass = hass;
    if(!this._booted){
      this._booted = true;
      // Wait for critical view modules (overview + follow), then render immediately.
      // Deferred views load in background after first paint.
      _criticalPromise.then(() => {
        _startDeferredLoads();
        // Keep-alive/watchdog starts immediately so recovery works even if
        // the first refresh hangs on a dead WS connection.
        this._startKeepAlive();
        // Start polling AFTER the first refresh resolves: dataMode comes from
        // settings fetched inside _refreshAll, so checking it synchronously
        // here always saw the "sample" default and never started the poll on
        // first boot (live data only began after a later set-hass re-entry).
        this._refreshAll(false).finally(() => {
          if(this.state.dataMode === "live") this._startDataPoll();
        });
      });
    } else if(hass && prevHass && hass !== prevHass && hass.connection !== prevHass.connection){
      // HA reconnected with a new WS connection (e.g. after network blip) — re-bootstrap
      this._pollInFlight = false;
      _criticalPromise.then(() => {
        this._ensureShadowDom();
        this._refreshAll(false);
        if(this.state.dataMode === "live") this._startDataPoll();
      });
    }
    // ── Sidebar re-entry recovery ────────────────────────────────────────────
    // HA calls set hass() when the user navigates back to PadSpan in the sidebar.
    // If disconnectedCallback ran (cleared timers/listeners), re-start them here.
    // This catches the case where HA re-attaches without calling connectedCallback.
    if(hass && this._booted && this.isConnected){
      if(!this._watchdogTimer || !this._activityTimer){
        this._startKeepAlive();
      }
      if(this.state.dataMode === "live" && !this._pollTimer){
        this._startDataPoll();
      }
      // If content is blank, rebuild + refresh (user just navigated back)
      if(this.$content && !this.$content.children.length){
        this._renderNav();
        this._scheduleRender();
        if(!this._sidebarRefreshing){
          this._sidebarRefreshing = true;
          this._refreshAll(false).finally(()=>{ this._sidebarRefreshing = false; });
        }
      }
    }
  }

  // ── connectedCallback ───────────────────────────────────────────────────────
  // Called when HA inserts the element into the DOM. Builds the entire shadow DOM
  // (sidebar, topbar, content area, modal/toast containers), wires up event
  // listeners, and kicks off the initial data load. Also called as a "nuclear
  // recovery" path by the watchdog when the DOM is irrecoverably corrupted.
  connectedCallback(){
    if(!this.shadowRoot) this.attachShadow({mode:"open"});
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="/padspan_ha_static/padspan-ha/styles.css?v=${APP_VERSION}&b=${BUILD_ID}">
      <!-- 2025 skin overlay. Deliberately href-less until _applySkin() decides:
           styles.css above is always the base, so a failed or disabled skin
           leaves the classic panel fully intact rather than unstyled. -->
      <link rel="stylesheet" id="skinLink">
      <style>
        /* Only :host fallback — do not override layout classes that styles.css already handles */
        :host{display:block;background:#0a150e;color:#e2e8f0;font-family:Inter,system-ui,Arial,sans-serif;box-sizing:border-box}
      </style>
      <div id="app" class="app">
        <div class="side-backdrop" id="sideBackdrop"></div>
        <aside class="left">
          <div class="sidebar-mobile-header" id="sidebarMobileHeader">
            <span style="font-weight:700;font-size:15px;flex:1">PadSpan HA</span>
            <button class="btn inline" id="sidebarClose" style="width:auto;font-size:18px;padding:4px 10px">&times;</button>
          </div>
          <div class="brand">
            <img src="/padspan_ha_static/padspan-ha/assets/padspan-mark.svg?b=${BUILD_ID}" alt="PadSpan" onerror="this.style.display='none'">
            <div>
              <div class="label">PadSpan™ HA</div>
              <div class="muted" style="margin-top:2px">v${APP_VERSION}${CHANNEL==='stable'?` <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#2e7d32;color:#fff;vertical-align:middle">${CHANNEL}</span>`:''}</div>
            </div>
          </div>

          <div class="toolbar" style="margin-top:10px">
            <button class="btn inline" id="refresh">Refresh</button>
            <button class="btn inline" id="autodiag">Auto Diagnostics</button>
            <button class="btn inline" id="toggleSide">Toggle</button>
          </div>

          <div style="margin-top:12px;margin-bottom:8px" class="muted" id="navLabel">Menu</div>
          <div class="nav" id="nav"></div>
        </aside>

        <main class="main">
          <div class="mobile-topbar" id="mobileTopbar">
            <button class="mobile-topbar-btn" id="mobileBackBtn" title="Back to Home Assistant" style="font-size:18px;padding:4px 6px">&#x2190;</button>
            <button class="mobile-topbar-btn" id="mobileMenuBtn">&#9776;</button>
            <span class="mobile-topbar-title" id="mobileTitle">Overview</span>
            <button class="mobile-topbar-pill" id="mobileDataPill">Sample</button>
            <button class="mobile-topbar-pill" id="mobileModePill">Advanced</button>
          </div>
          <div class="row desktop-topbar" style="margin-bottom:10px;align-items:center">
            <span class="pill" id="cloudBadge">Cloud disabled</span>
            <span class="pill" id="scanBadge">Scan: —</span>
            <span class="pill" id="statusBadge">Status: —</span>

            <span style="margin-left:auto;display:flex;align-items:center;gap:8px">
              <span class="muted" style="font-size:12px">Data</span>
              <button class="btn inline" id="dataModeToggle" title="Toggle sample vs live data">Sample</button>
              <button class="btn inline" id="complexityToggle" title="Cycle between Basic, Advanced, and Development modes">Advanced</button>
            </span>
          </div>
          <div id="toast" class="toast hidden"></div>
          <div id="modal" class="modal hidden"></div>
          <div id="content"></div>
        </main>

        <div class="mobile-bottom-nav" id="mobileBottomNav"></div>
      </div>
    `;

    this.$ = (q)=>this.shadowRoot.querySelector(q);
    this.$nav = this.$("#nav");
    this.$content = this.$("#content");
    this.$modal = this.$("#modal");

    // Kiosk chrome hiding runs after state init (URL parsed later in this
    // method) — schedule for after the constructor body completes.
    queueMicrotask(() => {
      if (!this.state?.kioskMode) return;
      try {
        const style = document.createElement("style");
        style.textContent = `
          .left, .desktop-topbar, .mobile-topbar, .mobile-bottom-nav { display: none !important; }
          .app { grid-template-columns: 1fr !important; }
          .main { padding: 0 !important; }
        `;
        this.shadowRoot.appendChild(style);
      } catch(e) { /* ignore */ }
    });

    // Measure actual available height — HA's toolbar offsets the panel
    // from the top of the viewport.  --header-height may not propagate
    // through shadow DOM, so measure directly and set on the app element.
    this._fitHeight = () => {
      try {
        const appEl = this.$("#app");
        if (appEl) {
          const rect = appEl.getBoundingClientRect();
          const avail = window.innerHeight - rect.top;
          if (avail > 100) appEl.style.height = avail + "px";
        }
      } catch(e) {}
    };
    requestAnimationFrame(() => this._fitHeight());
    window.addEventListener("resize", () => this._fitHeight());

    this.$("#refresh").addEventListener("click", ()=>this._refreshAll(true));
    this.$("#autodiag").addEventListener("click", ()=>this._runAutoDiag(true));
    this.$("#toggleSide").addEventListener("click", ()=>this.$("#app").classList.toggle("mini"));

    // Mobile navigation wiring
    const _openDrawer = () => {
      this.$("#app").classList.add("mobile-open");
      this.$("#sideBackdrop").classList.add("active");
    };
    const _closeDrawer = () => {
      this.$("#app").classList.remove("mobile-open");
      this.$("#sideBackdrop").classList.remove("active");
    };
    this.$("#mobileBackBtn").addEventListener("click", () => {
      // Navigate back to HA dashboard — works in Companion App on iPhone
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = "/";
      }
    });
    this.$("#mobileMenuBtn").addEventListener("click", _openDrawer);
    this.$("#sidebarClose").addEventListener("click", _closeDrawer);
    this.$("#sideBackdrop").addEventListener("click", _closeDrawer);
    this._closeDrawer = _closeDrawer;

    // Mobile topbar pills mirror the desktop toggles
    this.$("#mobileDataPill").addEventListener("click", async () => {
      const next = (this.state.dataMode === "sample") ? "live" : "sample";
      await this._setDataMode(next);
    });
    this.$("#mobileModePill").addEventListener("click", () => {
      // Re-use the same complexity toggle logic
      this.$("#complexityToggle").click();
    });

    // ── User interaction tracking ──────────────────────────────────────────
    // Records the timestamp of the last user interaction on the content area.
    // _renderCurrentView(fromPoll=true) checks this and skips re-renders within
    // 3 seconds of interaction, preventing form inputs / scroll positions from
    // being destroyed while the user is actively working.
    const _markInteraction = () => { this._lastUserInteraction = performance.now(); };
    this.$content.addEventListener("input", _markInteraction, true);
    this.$content.addEventListener("change", _markInteraction, true);
    this.$content.addEventListener("click", _markInteraction, true);
    this.$content.addEventListener("focusin", _markInteraction, true);
    this.$content.addEventListener("scroll", _markInteraction, true);

    this.$("#dataModeToggle").addEventListener("click", async ()=>{
      const next = (this.state.dataMode === "sample") ? "live" : "sample";
      await this._setDataMode(next);
    });

    // Restore persisted complexity preference (Basic/Advanced/Dev survives page reloads)
    try {
      const saved = localStorage.getItem("padspan_complexity");
      if (saved === "basic" || saved === "advanced" || saved === "development") this.state.complexity = saved;
    } catch(e) { /* ignore */ }

    // ── URL deep-link: ?view=<id> and ?kiosk=1 ──
    // /padspan-ha?view=purelive opens that view regardless of the browser's
    // complexity mode (wall monitors have fresh localStorage); kiosk=1 also
    // hides the panel chrome for a clean always-on display.
    try {
      const q = new URLSearchParams(window.location.search);
      const reqView = q.get("view");
      if (reqView && _VIEW_PATHS[reqView]) {
        this.state.view = reqView;
        this._urlPinnedView = reqView;   // exempt from complexity-fallback
      }
      this.state.kioskMode = q.get("kiosk") === "1";
    } catch(e) { /* ignore */ }

    this.$("#complexityToggle").addEventListener("click", ()=>{
      const cur = this.state.complexity;
      this.state.complexity = cur === "basic" ? "advanced" : cur === "advanced" ? "development" : "basic";
      try { localStorage.setItem("padspan_complexity", this.state.complexity); } catch(e) {}
      // If switching to basic/advanced and current view isn't visible, go to
      // follow — unless the URL explicitly pinned the view (kiosk deep-link).
      if (this.state.complexity !== "development") {
        const visible = this._getVisibleTabs();
        if (!visible.has(this.state.view) && this.state.view !== this._urlPinnedView) this.state.view = "follow";
      }
      this._updateBadges();
      this._renderNav();
      this._scheduleRender();
    });

    this._renderNav();
    // Load persisted mode (sample/live) even before hass is set.
    // When hass arrives we refresh.
    this._loadSettings();

    // Always start keep-alive (activity ping + watchdog) regardless of data mode.
    this._startKeepAlive();

    // If views are already populated (reconnect after detach), render immediately.
    // Otherwise show a loading placeholder then render once dynamic imports settle.
    if(Object.keys(VIEWS).length > 0){
      this._scheduleRender();
      this._startPolling();
      // On reconnect (not first boot), refresh data to recover from stale state
      if(this._booted && this._hass){
        this._pollInFlight = false;
        this._refreshAll(false);
      }
    } else {
      // Show loading placeholder with progress — purely inline so it works with no CSS loaded yet
      if(this.$content){
        const lo = document.createElement("div");
        lo.style.cssText = "padding:40px;text-align:center;font-family:system-ui,sans-serif";
        lo.innerHTML = `<div style="margin-bottom:16px"><svg width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="none" stroke="#1b3526" stroke-width="4"/><circle cx="24" cy="24" r="20" fill="none" stroke="#52b788" stroke-width="4" stroke-linecap="round" stroke-dasharray="80 45"><animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="1s" repeatCount="indefinite"/></circle></svg></div>`
          + `<div style="color:#52b788;font-size:16px;font-weight:700;margin-bottom:6px">PadSpan HA v${APP_VERSION}</div>`
          + `<div style="color:#64748b;font-size:12px" id="padspan-load-status">Loading modules\u2026</div>`;
        this.$content.appendChild(lo);
      }
      _criticalPromise.then(() => {
        _startDeferredLoads();
        const statusEl = this.$content?.querySelector("#padspan-load-status");
        if(statusEl) statusEl.textContent = "Connecting\u2026";
        this._renderNav();       // rebuild nav after complexity may have been restored
        this._scheduleRender();
        this._startPolling();
      });
    }
  }


  // ── disconnectedCallback ────────────────────────────────────────────────────
  // Called when HA removes the element from the DOM (e.g. user navigates away).
  // Full cleanup: clear ALL timers and event listeners to prevent zombie timers
  // if HA creates a new element instance. connectedCallback will recreate them.
  disconnectedCallback(){
    this._stopDataPoll();
    this._pollInFlight = false;
    if(this._activityTimer){ clearInterval(this._activityTimer); this._activityTimer = null; }
    if(this._watchdogTimer){ clearInterval(this._watchdogTimer); this._watchdogTimer = null; }
    if(this._visibilityHandler){
      document.removeEventListener("visibilitychange", this._visibilityHandler);
      this._visibilityHandler = null;
    }
    if(this._focusHandler){
      window.removeEventListener("focus", this._focusHandler);
      this._focusHandler = null;
    }
    if(this._pageshowHandler){
      window.removeEventListener("pageshow", this._pageshowHandler);
      this._pageshowHandler = null;
    }
    if(this._haLocationHandler){
      window.removeEventListener("location-changed", this._haLocationHandler);
      this._haLocationHandler = null;
    }
    if(this._interactionHandler){
      this.removeEventListener("pointerdown", this._interactionHandler);
      this._interactionHandler = null;
    }
    if(this._modalEsc){
      window.removeEventListener("keydown", this._modalEsc);
      this._modalEsc = null;
    }
  }

  // ── Anti-blank system ─────────────────────────────────────────────────────
  // Four independent mechanisms prevent the panel from going blank:
  // 1. Activity ping — synthetic pointer events keep HA's idle overlay away
  // 2. Watchdog — detects empty/stale content and forces a full rebuild
  // 3. Visibility handler — immediate recovery when tab regains focus
  // 4. hass reconnect detection — re-bootstraps on WS connection change

  _ensureShadowDom(){
    // Verify shadowRoot has the expected structure. If not, rebuild entirely.
    if(!this.shadowRoot) return false;
    const liveContent = this.shadowRoot.querySelector("#content");
    if(!liveContent || !this.shadowRoot.querySelector("#app")){
      // Shadow DOM was cleared externally — full rebuild
      this.connectedCallback();
      return true;
    }
    // Fix stale references: this.$content might point at a detached node
    if(this.$content !== liveContent){
      this.$ = (q)=>this.shadowRoot.querySelector(q);
      this.$content = liveContent;
      this.$nav = this.$("#nav");
      this.$modal = this.$("#modal");
      return true;
    }
    return false;
  }

  _startKeepAlive(){
    // ── Activity ping (30s) ─────────────────────────────────────────────────
    // Synthetic pointer events keep HA's idle overlay away. Dispatches on
    // document, window, AND the HA root element with both trusted event types.
    if(!this._activityTimer){
      const ping = ()=>{
        try {
          for(const EvType of [PointerEvent, MouseEvent]){
            for(const name of ["pointermove","mousemove"]){
              try {
                const ev = new EvType(name, {bubbles:true, composed:true, cancelable:true});
                document.dispatchEvent(ev);
                window.dispatchEvent(ev);
              } catch(e){}
            }
          }
          const haRoot = document.querySelector("home-assistant");
          if(haRoot) haRoot.dispatchEvent(new Event("mousemove", {bubbles:true}));
        } catch(e){}
      };
      ping();
      this._activityTimer = setInterval(ping, 25_000);
    }

    // ── Watchdog (8s) ───────────────────────────────────────────────────────
    // Checks DOM integrity, content visibility, stuck polls, and poll liveness.
    // This is the last line of defense against blank screens.
    if(!this._watchdogTimer){
      this._watchdogTimer = setInterval(()=>{
        try {
          if(!this.isConnected) return;

          // 1. Stale shadow DOM references — fix before anything else
          const rebuilt = this._ensureShadowDom();
          if(rebuilt){ this._scheduleRender(); return; }

          // 2. Verify $content exists and is live
          if(!this.$content || !this.$content.isConnected){
            console.warn("PadSpan watchdog: $content missing/disconnected — full rebuild");
            this.connectedCallback();
            return;
          }

          // 3. Content area empty OR visually zero-height
          const empty = !this.$content.children.length;
          let zeroHeight = false;
          try { zeroHeight = this.$content.getBoundingClientRect().height < 2; } catch(e){}
          if(empty || zeroHeight){
            console.warn("PadSpan watchdog: content blank (empty=%s, zeroH=%s) — forcing render", empty, zeroHeight);
            // Force render: bypass all guards by not passing fromPoll
            this._scheduleRender();
            // If still empty after sync render, escalate to full refresh
            if(!this.$content.children.length){
              this._pollInFlight = false;
              this._refreshAll(false);
            }
          }

          // 4. Unstick deadlocked poll (hung > 20s)
          if(this._pollInFlight && this._pollStartedAt){
            if(performance.now() - this._pollStartedAt > 20_000){
              console.warn("PadSpan watchdog: poll stuck for >20s — unsticking");
              this._pollInFlight = false;
              this._scheduleRender();
            }
          }

          // 5. Ensure data poll is alive in live mode
          if(this.state.dataMode === "live" && !this._pollTimer){
            this._startDataPoll();
          }

          // 6. Escalation: no successful render in 20s → full rebuild
          // Skip for non-live views (calibration, maps, etc.) — they don't poll-render,
          // so _lastGoodRender goes stale naturally. Forcing a render mid-drag breaks things.
          const _liveSet = new Set(["overview","follow","monitor"]);
          const _isLiveView = _liveSet.has(this.state?.view);
          const sinceGoodRender = this._lastGoodRender ? performance.now() - this._lastGoodRender : 0;
          if(sinceGoodRender > 20_000){
            if(!_isLiveView){
              // Non-live view: just reset the timer, don't force render
              this._lastGoodRender = performance.now();
            } else if((this._renderFailCount || 0) >= 2){
              console.warn("PadSpan watchdog: no successful render in 20s + %d failures — full rebuild", this._renderFailCount);
              this._renderFailCount = 0;
              this._lastGoodRender = performance.now();
              this._pollInFlight = false;
              this.connectedCallback();
            } else {
              // Try a non-poll render first before escalating
              console.warn("PadSpan watchdog: no successful render in 20s — forcing render");
              this._scheduleRender();
            }
          }
        } catch(e){
          // Even the watchdog crashed — nuclear recovery
          console.error("PadSpan watchdog error — rebuilding:", e);
          try { this.connectedCallback(); } catch(e2){}
        }
      }, 5_000);
    }

    // ── Visibility change (browser tab show/hide) ───────────────────────────
    if(!this._visibilityHandler){
      this._visibilityHandler = ()=>{
        if(document.visibilityState === "visible") this._wakeUp("visibilitychange");
      };
      document.addEventListener("visibilitychange", this._visibilityHandler);
    }

    // ── Window focus (browser window regains focus) ─────────────────────────
    // Fires on Alt-Tab back, clicking the browser from taskbar, etc.
    // visibilitychange does NOT fire for these on all browsers.
    if(!this._focusHandler){
      this._focusHandler = ()=> this._wakeUp("focus");
      window.addEventListener("focus", this._focusHandler);
    }

    // ── Page show (bfcache restore, navigation) ─────────────────────────────
    if(!this._pageshowHandler){
      this._pageshowHandler = (ev)=>{
        if(ev.persisted) this._wakeUp("pageshow");
      };
      window.addEventListener("pageshow", this._pageshowHandler);
    }

    // ── HA location-changed (sidebar navigation within HA) ──────────────────
    // HA fires this custom event on every route change. When the user clicks
    // PadSpan in the sidebar after visiting another panel, this wakes us up
    // even though visibilitychange won't fire (page was never hidden).
    if(!this._haLocationHandler){
      this._haLocationHandler = ()=>{
        // Only wake if we're actually connected (HA re-attached our element)
        if(this.isConnected) this._wakeUp("ha-location");
      };
      window.addEventListener("location-changed", this._haLocationHandler);
    }

    // ── Interaction recovery (user clicks on panel) ─────────────────────────
    // If the panel looks blank and the user clicks anywhere inside it,
    // immediately check health and rebuild if needed.
    if(!this._interactionHandler){
      this._interactionHandler = ()=>{
        if(!this.$content) return;
        if(!this.$content.children.length){
          console.warn("PadSpan: user click on blank panel — recovering");
          this._scheduleRender();
          this._refreshAll(false);
        }
      };
      this.addEventListener("pointerdown", this._interactionHandler);
    }
  }

  // ── Render Scheduler ──────────────────────────────────────────────────────
  // User-triggered renders (tab clicks, actions): execute IMMEDIATELY.
  // Background renders (poll, wakeUp, refreshAll): batch via rAF to prevent
  // multiple DOM rebuilds within the same frame.
  _scheduleRender(fromPoll = false) {
    if (!fromPoll) {
      // User action — render immediately, no delay
      this._renderCurrentView(false);
      return;
    }
    // Background/poll — batch via requestAnimationFrame
    if (this._renderRAF) return; // already batched
    this._renderRAF = requestAnimationFrame(() => {
      this._renderRAF = null;
      this._renderCurrentView(true);
    });
  }

  // Unified wake-up handler — called by all recovery triggers
  _wakeUp(source){
    if(!this._hass || !this.isConnected) return;
    this._pollInFlight = false;
    this._ensureShadowDom();
    this._scheduleRender();
    this._refreshAll(false);
    if(this.state.dataMode === "live" && !this._pollTimer) this._startDataPoll();
  }

  // ── Data Polling ────────────────────────────────────────────────────────────
  // The 5-second poll loop keeps "Live" mode actually live by periodically
  // fetching fresh snapshot + status data from the backend via WebSocket.
  // Polling is ONLY active in live mode — sample mode uses static demo data.
  // The poll loop is separate from the keep-alive system (activity ping + watchdog)
  // which runs regardless of data mode to prevent blank screens.

  _startDataPoll(){
    if(this._pollTimer) return;
    // Match UI refresh rate to the presence poll interval setting (default 5s, min 1s)
    const pollS = (this.state.settings && this.state.settings.presence_poll_interval_s) || 5;
    const pollMs = Math.max(1000, Math.min(10000, pollS * 1000));
    this._pollTimer = setInterval(()=>this._pollTick(), pollMs);
  }

  _startPolling(){
    this._startDataPoll();
    this._startKeepAlive();
  }

  _stopDataPoll(){
    if(this._pollTimer){
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _stopPolling(){
    this._stopDataPoll();
    // Keep-alive timers + event handlers are NOT stopped here —
    // they protect against blank screens regardless of data mode.
  }

  /**
   * Single poll iteration — called every 5s by _pollTimer.
   * Guards prevent overlapping calls, polling in sample mode, and interrupting
   * the maps view (where drawing/dragging would break on DOM rebuild).
   * After fetching data, triggers a "from poll" re-render which respects
   * interaction guards (_dragging, _confirming, focused inputs, recent clicks).
   */
  async _pollTick(){
    if(!this._hass) return;
    if(this.state.dataMode !== "live") return;
    if(this._pollInFlight) return;
    if(this.state.view === "maps") return;

    this._pollInFlight = true;
    this._pollStartedAt = performance.now();
    const t0 = this._pollStartedAt;
    try{
      // Race WS calls against a 15s timeout to prevent indefinite hangs
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("poll_timeout")), 15_000));
      await Promise.race([
        (async ()=>{
          // Heal path: if the boot fetch of the map geometry failed (e.g. the
          // WS connection died mid-batch), nothing else ever re-fetched it and
          // the floor plan stayed blank until a manual refresh. Both calls are
          // tiny; re-fetch whenever the state is still empty.
          if(!(this.state.maps.list || []).length){
            await this._getMapsList(false).catch(()=>{});
          }
          if(!((this.state.model || {}).floors || []).length){
            await this._getModel();
          }
          await this._getLiveSnapshot();
          await this._getStatus();
        })(),
        timeout,
      ]);
      this.state.timing.lastRefreshMs = Math.round(performance.now() - t0);
      this._updateBadges();

      // Re-render views that show live data.
      // Overview uses its own efficient _isoUpdateObjects() path (no full rebuild)
      // so it can safely update every 5s.  Other live views (follow, monitor) do
      // a full DOM rebuild which causes flicker — throttle those to every 35s.
      const _view = this.state.view;
      const _fastViews = new Set(["overview","purelive"]);  // efficient partial update
      const _slowViews = new Set(["follow","monitor"]);                 // full rebuild — throttle
      const _SLOW_INTERVAL = 35_000;

      if(_fastViews.has(_view)){
        // Overview: always re-render (uses _isoUpdateObjects or Preact diffing)
        const stale = this._lastGoodRender && (performance.now() - this._lastGoodRender > 10_000);
        const usePollMode = !stale || _view === "overview";
        this._scheduleRender(usePollMode);
      } else if(_slowViews.has(_view)){
        // Follow/Monitor: only re-render every 35s to avoid flicker
        const sinceLastRender = this._lastGoodRender ? (performance.now() - this._lastGoodRender) : _SLOW_INTERVAL;
        if(sinceLastRender >= _SLOW_INTERVAL){
          this._scheduleRender(true);
        }
      }
    } catch(e){
      // Non-fatal — snapshot is preserved from last good fetch.
      // Only re-render if screen might be stale (> 10s since last good render).
      if(!this._lastGoodRender || (performance.now() - this._lastGoodRender > 10_000)){
        try { this._scheduleRender(); } catch(e2){}
      }
    } finally {
      this._pollInFlight = false;
      this._pollStartedAt = null;
    }
  }

  // ── WebSocket Helpers ───────────────────────────────────────────────────────
  // All backend communication goes through hass.callWS (HA's WS API).
  // _callWS wraps it with call counting (for Diagnostics) and event logging
  // (for the session Events tab). Views never call hass.callWS directly —
  // they use ctx.actions.callWS or the typed action methods.

  _wsCount(type){
    this.state.wsCounts[type] = (this.state.wsCounts[type]||0)+1;
  }

  _logEvent(type, detail){
    this.state._sessionEvents.push({ ts: Date.now(), type, detail: detail || "" });
    if(this.state._sessionEvents.length > 500) this.state._sessionEvents.shift();
  }

  async _callWS(payload){
    if(!this._hass) throw new Error("hass not ready");
    this._wsCount(payload.type);
    this._logEvent("ws_call", payload.type);
    return await this._hass.callWS(payload);
  }

  // Fetch settings and store quietly (no re-render, no toast) — called from _refreshAll
  async _fetchSettings(){
    try{
      const res = await this._callWS({ type: "padspan_ha/settings_get" });
      if(res?.settings){
        this.state.settings = res.settings;
        if ("cpu_pinning_supported" in res) this.state.cpuPinningSupported = !!res.cpu_pinning_supported;
        const mode = (res.settings.data_mode || "sample").toLowerCase();
        this.state.dataMode = (mode === "live") ? "live" : "sample";
        // Load followed addrs from server ONCE on boot (not on every poll,
        // which would race with local toggles and revert user clicks)
        if(!this._followedLoadedFromServer && Array.isArray(res.settings.followed_addrs)){
          this.state.followedAddrs = new Set(res.settings.followed_addrs);
          this._followedLoadedFromServer = true;
        }
      }
    }catch(e){}
  }
  async _loadAlertConfigs(){
    try{
      const res = await this._callWS({ type: "padspan_ha/follow_alert_get" });
      if(res?.configs) this.state.followAlertConfig = res.configs;
    }catch(e){}
  }

  // ── Data Loading ────────────────────────────────────────────────────────────
  // These methods fetch data from the backend and update this.state.
  // They are called from _refreshAll (full bootstrap) and individually
  // from specific actions (e.g. after tagging an object, after map upload).

  // Light theme = full colour inversion of the panel (accessibility: the
  // dark theme is unusable for some eye conditions). Applied as a filter on
  // the host element; styles.css counter-inverts photos/map images via the
  // data-invert attribute so they don't render as negatives.
  _applyTheme(){
    const on = !!this.state.settings?.light_theme;
    this.style.filter = on ? "invert(1) hue-rotate(180deg)" : "";
    if (on) this.setAttribute("data-invert", ""); else this.removeAttribute("data-invert");
  }

  // Chrome skin. "classic" is v0.35.0 untouched; "2025" links styles-2025.css
  // on top of styles.css and switches _renderNav to the grouped icon list.
  // Anything other than the exact string "2025" means classic, so a bad or
  // missing setting can never strand someone on a skin that failed to load.
  //
  // Note this is independent of light_theme: both skins still invert the host
  // for light mode, because the view modules carry ~4,500 hardcoded hex
  // literals that currently depend on that inversion. Converting those to
  // tokens is a separate, view-by-view job.
  _applySkin(){
    const skin = (this.state.settings?.ui_skin === "2025") ? "2025" : "classic";
    if (this._skin === skin) return false;
    this._skin = skin;
    this.setAttribute("data-skin", skin);
    const link = this.shadowRoot?.querySelector("#skinLink");
    if (link) {
      if (skin === "2025") {
        link.href = `/padspan_ha_static/padspan-ha/styles-2025.css?v=${APP_VERSION}&b=${BUILD_ID}`;
      } else {
        link.removeAttribute("href");
      }
    }
    return true;
  }

  async _loadSettings(){
    try {
      if(!this._hass) return;
      const res = await this._callWS({ type: "padspan_ha/settings_get" });
      this.state.settings = res?.settings || {};
      this._applyTheme();
      this._applySkin();
      if (res && "cpu_pinning_supported" in res) this.state.cpuPinningSupported = !!res.cpu_pinning_supported;
      const mode = (res?.settings?.data_mode || "sample").toLowerCase();
      this.state.dataMode = (mode === "live") ? "live" : "sample";
      this._updateBadges();
      this._renderNav();
      this._scheduleRender();
    } catch (e) {
      // Non-fatal
      this._toast("Settings load failed (will retry on refresh).", true);
    }
  }

  /**
   * Switch between "sample" and "live" data modes.
   * Sample mode: assigns SAMPLE_SNAPSHOT (static demo data) so all views work
   *   without real BLE hardware — useful for demos and development.
   * Live mode: clears the sample snapshot and starts polling the backend for
   *   real BLE data every 5 seconds.
   * The choice is persisted server-side via settings_set.
   */
  async _setDataMode(mode){
    try {
      const res = await this._callWS({ type: "padspan_ha/settings_set", data_mode: mode });
      const m = (res?.settings?.data_mode || "sample").toLowerCase();
      this.state.dataMode = (m === "live") ? "live" : "sample";
      this._toast(`Data mode: ${this.state.dataMode.toUpperCase()}`);
      // When switching to sample, explicitly assign sample snapshot.
      // When switching to live, clear the sample snapshot so _getLiveSnapshot fetches fresh.
      if(this.state.dataMode !== "live"){
        this.state.live.snapshot = SAMPLE_SNAPSHOT;
        this._recomputeDerived();
      } else {
        // Clear sample snapshot so first live fetch replaces it
        if(this.state.live.snapshot === SAMPLE_SNAPSHOT) this.state.live.snapshot = null;
      }
      await this._refreshAll(false);
      if(this.state.dataMode === "live") this._startPolling();
      else this._stopPolling();
    } catch (e) {
      this._toast("Failed to switch data mode. See Diagnostics.", true);
      console.error(e);
    }
  }

  async _getVersionInfo(){
    try {
      const res = await this._callWS({ type: "padspan_ha/version" });
      this.state.versionInfo = res;
    } catch (e) {
      this.state.versionInfo = null;
    }
  }

  async _getStatus(){
    const res = await this._callWS({ type: "padspan_ha/status" });
    const entry = (res?.entries && res.entries[0]) ? res.entries[0] : {};
    this.state.status = entry;
  }

  /**
   * Recompute derived state from the latest snapshot.
   * The room-tag map has three layers: saved (persisted), live (from snapshot),
   * and missing (tags referencing rooms that no longer exist in HA).
   * This separation lets the UI show live positions while preserving the
   * saved map for settings/configuration views.
   */
  _recomputeDerived(){
    const saved = this.state.savedRoomTagMap || {};
    const snap = this.state.live?.snapshot;
    if(snap && snap.room_tag_map){
      this.state.roomTagMap = (snap.room_tag_map_live || snap.room_tag_map) || {};
      this.state.missingRoomTagMap = snap.room_tag_map_missing || {};
      // Only update savedRoomTagMap from live data (sample snapshot has no persistent map)
      if(this.state.dataMode === "live"){
        this.state.savedRoomTagMap = snap.room_tag_map_saved || {};
      }
    } else {
      this.state.roomTagMap = saved || {};
    }
  }

  async _getRoomTags(){
    const res = await this._callWS({ type: "padspan_ha/room_tags" });
    this.state.savedRoomTagMap = res?.room_tag_map || {};
    this._recomputeDerived();
    if(res?.sources) this.state.live.sources = res.sources;
  }

  /**
   * Fetch the live BLE snapshot from the backend, or use SAMPLE_SNAPSHOT in sample mode.
   * Sample mode uses a static demo snapshot (from sample_data.js) so every view
   * renders with realistic data even without any BLE hardware connected.
   * In live mode, we keep the last good snapshot on failure to prevent UI flickering.
   */
  async _getLiveSnapshot(){
    if(this.state.dataMode !== "live") {
      // But only assign if we don't already have a live snapshot cached
      // (prevents race conditions during _refreshAll where settings haven't loaded yet).
      if(!this.state.live.snapshot || this.state.live.snapshot === SAMPLE_SNAPSHOT){
        this.state.live.snapshot = SAMPLE_SNAPSHOT;
      }
      this.state.live.error = null;
      this._recomputeDerived();
      return;
    }
    try {
      const res = await this._callWS({ type: "padspan_ha/live_snapshot" });
      const snap = res?.snapshot;
      // Only replace the snapshot if we got a valid response.
      // Keep the last good snapshot on WS failure to prevent flickering.
      if(snap && typeof snap === "object"){
        this.state.live.snapshot = snap;
        this.state.live.error = null;
        this._recomputeDerived();
        const objCount = snap?.objects?.summary?.total ?? 0;
        this._logEvent("snapshot", `${objCount} objects`);
      }
    } catch(e) {
      // Keep whatever snapshot we had — do NOT wipe to null
      this.state.live.error = String(e);
    }
  }

  async _getMapsList(retry = true){
    // The floor plan is invisible without this list, so unlike other fetches
    // a failure here gets one retry, and a failed/malformed response never
    // clobbers a previously-good list (blank-map prevention).
    try {
      const res = await this._callWS({ type: "padspan_ha/maps_list" });
      if(Array.isArray(res?.maps)){
        this.state.maps.list = res.maps;
        if(this.state.activeMapId && !this.state.maps.list.find(m=>m.id===this.state.activeMapId)){
          this.state.activeMapId = null;
        }
      }
    } catch(e){
      if(retry){
        await new Promise(r => setTimeout(r, 1000));
        return this._getMapsList(false);
      }
      console.warn("PadSpan: maps_list failed after retry:", e);
      throw e;  // let callers (allSettled logging) see the failure
    }
  }


  async _getModel(){
    try {
      const res = await this._callWS({ type: "padspan_ha/model_get" });
      // Copy EVERYTHING the backend sends. This used to be a hand-written
      // whitelist, and it dropped keys three separate times in one session —
      // origin forwarding, the migration marker, then light_positions_m and
      // floor_elevations, which left every correctly-placed light rendering as
      // unplaced. A whitelist here can only ever be wrong in one direction:
      // the backend adds a field, the panel silently discards it, and the
      // symptom shows up somewhere unrelated. Defaults below exist only so
      // views can index the common collections without null checks; any key
      // the backend adds from now on simply arrives.
      const defaults = {
        floors: [], areas: [], room_meta: {}, scanners: {}, room_adjacency: {},
        fabric_sync_mode: "auto", scanner_positions_m: {}, room_geometry_m: {},
        rf_barriers_m: [], map_transforms: {}, beacon_positions_m: {},
        light_positions_m: {}, floor_elevations: {}, fabric_floors: {},
      };
      this.state.model = { ...defaults, ...(res && typeof res === "object" ? res : {}) };
    } catch (e) {
      // non-fatal
      console.warn("model_get failed", e);
    }
    // Views that resolve HA area NAMES (the Lights tab's entity registry
    // pipeline) must wait for this fetch to settle — resolving before it
    // lands marks every light unassigned and caches that. Set on failure
    // too, or the view would show a loading state forever.
    this.state._modelLoaded = true;
  }

  async _runAutoDiag(userAction=false){
    try {
      const t0 = performance.now();
      const res = await this._callWS({ type: "padspan_ha/auto_diagnostics" });
      this.state.diag = res;
      this.state.timing.lastDiagMs = Math.round(performance.now() - t0);
      if(userAction) this._toast("Auto diagnostics complete.");
    } catch (e) {
      this.state.diag = {
        version: APP_VERSION,
        error: String(e),
        summary: { ok:false, total:1, passed:0, failed:1 },
        checks: [{ name:"ws_auto_diagnostics", ok:false, detail:String(e) }],
        recommendations: ["Check Home Assistant logs for padspan_ha errors."],
      };
      if(userAction) this._toast("Auto diagnostics failed. See Diagnostics.", true);
    }
  }

  /**
   * Full data refresh — fetches ALL backend state in parallel.
   * Called on boot, reconnect, wake-up, and user "Refresh" button.
   *
   * IMPORTANT ordering: settings are fetched FIRST (awaited) so that dataMode
   * is correct before _getLiveSnapshot runs. Without this, a race condition
   * causes _getLiveSnapshot to see "sample" mode and assign SAMPLE_SNAPSHOT
   * even when the user is in live mode.
   */
  async _refreshAll(userAction=false){
    if(!this._hass) return;
    const t0 = performance.now();
    if(userAction) this._toast("Refreshing…");
    await Promise.allSettled([this._fetchSettings()]);
    // Fetch the small critical geometry FIRST, awaited: the floor plan is
    // unrenderable without maps_list + model, and batching them with the
    // heavyweight live_snapshot meant a snapshot big enough to kill the WS
    // connection took the map geometry down with it (blank map on first
    // entry). These two are tiny; land them before anything heavy runs.
    const critResults = await Promise.allSettled([
      this._getMapsList(),
      this._getModel(),
    ]);
    // Now run remaining fetches in parallel (dataMode is now correct)
    const results = await Promise.allSettled([
      this._getVersionInfo(),
      this._getStatus(),
      this._getRoomTags(),
      this._getLiveSnapshot(),
      this._runAutoDiag(false),
      this._loadAlertConfigs(),
    ]);
    // Log any WS failures to console for debugging
    const critNames = ["getMapsList","getModel"];
    critResults.forEach((r,i)=>{ if(r.status==="rejected") console.warn("PadSpan refresh:", critNames[i], "failed:", r.reason); });
    const names = ["getVersionInfo","getStatus","getRoomTags","getLiveSnapshot","runAutoDiag","loadAlerts"];
    results.forEach((r,i)=>{ if(r.status==="rejected") console.warn("PadSpan refresh:", names[i], "failed:", r.reason); });
    this._recomputeDerived();
    try { this.state.timing.lastRefreshMs = Math.round(performance.now() - t0); } catch(e){}
    try { this._updateBadges(); } catch(e){}
    this._scheduleRender();
  }

  /** Update the desktop topbar status pills and mobile topbar pills to reflect current state. */
  _updateBadges(){
    const scan = this.state.status?.scan_interval ?? "—";
    const st = this.state.status?.status ?? "—";
    this.$("#scanBadge").textContent = `Scan: ${scan}s`;
    this.$("#statusBadge").textContent = `Status: ${st}`;
    this.$("#cloudBadge").textContent = "Cloud disabled";

    const b = this.$("#dataModeToggle");
    if(b) b.textContent = (this.state.dataMode === "live") ? "Live" : "Sample";
    const cb = this.$("#complexityToggle");
    if(cb){
      const mode = this.state.complexity;
      cb.textContent = mode === "basic" ? "Basic" : mode === "advanced" ? "Advanced" : "Dev";
      cb.style.outline = mode === "basic" ? "2px solid rgba(94,234,212,.6)"
                       : mode === "development" ? "2px solid rgba(239,83,80,.5)" : "";
    }
  }

  // ── Navigation & View Routing ───────────────────────────────────────────────
  // The sidebar (desktop) and bottom nav (mobile) are built from the MENU array,
  // filtered by the current complexity mode. Clicking a nav item sets state.view
  // and calls _renderCurrentView(), which looks up the module in the VIEWS map
  // and calls its render(ctx) function.

  /** Return the Set of tab IDs visible in the current complexity mode. */
  _getVisibleTabs(){
    const mode = this.state.complexity;
    // Forensics is settings-gated in EVERY mode (including Dev): the tab only
    // exists while the opt-in forensics_enabled setting is on.
    const forensicsOn = this.state.settings?.forensics_enabled === true;
    let out;
    if (mode === "development") {
      out = new Set(MENU.map(x => x[0]));
      if (!forensicsOn) out.delete("forensics");
    } else if (mode === "basic") {
      out = new Set(BASIC_TABS);
      if (forensicsOn) out.add("forensics");
    } else {
      // Advanced: base + any user-opted extra tabs
      const extras = this.state.settings?.advanced_extra_tabs || [];
      out = new Set(ADVANCED_DEFAULT);
      for (const t of extras) out.add(t);
      if (forensicsOn) out.add("forensics");
    }
    // The EDITION decides last: a Bright build shows its lighting surfaces
    // (and the rest only behind the reveal switch). The full edition is
    // untouched by this — surfacesForEdition returns its input.
    if (EDITIONS && EDITIONS.surfacesForEdition) {
      out = new Set(EDITIONS.surfacesForEdition([...out], this.state.settings || {}));
    }
    return out;
  }

  /** Rebuild the sidebar nav, mobile bottom nav, and mobile topbar to match current state. */
  _renderNav(){
    const isBasic = this.state.complexity === "basic";
    const visible = this._getVisibleTabs();
    this.$nav.innerHTML = "";
    this.$nav.className = isBasic ? "nav basic-nav" : "nav";
    const navLabel = this.shadowRoot.querySelector("#navLabel");
    if(navLabel) navLabel.textContent = isBasic ? "Basic Menu" : this.state.complexity === "development" ? "Dev Menu" : "Menu";

    const items = MENU.filter(x => visible.has(x[0]));
    // A view this build does not show cannot stay current: a Bright install
    // starts on Overview by default and Overview is a presence surface, so it
    // lands on the first surface it does show (Mapping).
    if (items.length && !visible.has(this.state.view) && !_VIEW_PATHS_HIDDEN_OK.has(this.state.view)) {
      this.state.view = items[0][0];
      this._scheduleRender();
    }
    const _switchView = (id) => {
      // Clear traceback active flag when leaving traceback tab
      if (this.state._traceback && this.state.view === "traceback" && id !== "traceback") {
        this.state._traceback.active = false;
        if (this.state._traceback._animTimer) {
          clearInterval(this.state._traceback._animTimer);
          this.state._traceback._animTimer = null;
          this.state._traceback.playing = false;
        }
      }
      this.state.view = id;
      this._logEvent("view_change", id);
      // Opt-in usage report: count the tab open. Nothing leaves the browser
      // unless the person turned the report on (Settings → Update Check & Privacy).
      if (this.state.settings && this.state.settings.telemetry_enabled) {
        this._callWS({ type: "padspan_ha/telemetry_event", event: "tab:" + id }).catch(() => {});
      }
      if (this._closeDrawer) this._closeDrawer();
      this._renderNav();
      // On-demand: if the view module isn't loaded yet, fetch it then render
      if (!VIEWS[id] && _VIEW_PATHS[id]) {
        this._scheduleRender(); // shows skeleton placeholder
        _loadView(id).then(() => this._scheduleRender());
      } else {
        this._scheduleRender();
      }
    };

    if (this._skin === "2025") {
      // Grouped icon list. `items` above stays the flat, MENU-ordered
      // visibility set — the items[0][0] fallback a few lines up depends on
      // that, so headings are appended as a separate pass and never enter it.
      const byId = new Map(items.map(x => [x[0], x[1]]));
      const _navButton = (id, label) => {
        const btn = el("button", {
          class: "navbtn" + (this.state.view === id ? " active" : ""),
          title: label,          // survives the collapse to the 60px icon rail
          onclick: () => _switchView(id)
        });
        // MENU_ICONS is a module constant, never user input.
        btn.innerHTML = `<svg class="navicon" viewBox="0 0 24 24" aria-hidden="true">${MENU_ICONS[id] || ""}</svg>`;
        btn.appendChild(el("span", { class: "navlabel" }, label));
        return btn;
      };
      const seen = new Set();
      let firstHeading = true;
      const _heading = (text) => {
        // Basic mode shows five tabs; headings would outnumber the content.
        if (isBasic) return;
        this.$nav.appendChild(el("div", { class: "navgrp" + (firstHeading ? " first" : "") }, text));
        firstHeading = false;
      };
      for (const [heading, ids] of MENU_GROUPS) {
        const present = ids.filter(id => byId.has(id));
        if (!present.length) continue;
        _heading(heading);
        for (const id of present) { seen.add(id); this.$nav.appendChild(_navButton(id, byId.get(id))); }
      }
      // A MENU entry that nobody added to MENU_GROUPS still renders.
      const orphans = items.filter(x => !seen.has(x[0]));
      if (orphans.length) {
        _heading("More");
        for (const [id, label] of orphans) this.$nav.appendChild(_navButton(id, label));
      }
    } else {
      for(const [id,label] of items.map(x=>[x[0],x[1]])) {
        const color = MENU_COLORS[id] || "#37588f";
        const btn = el("button",{
          class:"navbtn"+(this.state.view===id?" active":""),
          style:`--navcolor:${color}`,
          onclick:()=>_switchView(id)
        }, [el("span",{class:"navdot"}), el("span",{}, label)]);
        this.$nav.appendChild(btn);
      }
    }

    // ── Mobile bottom nav: pinned tabs + "More" button ──────────────
    const bottomNav = this.shadowRoot.querySelector("#mobileBottomNav");
    if (bottomNav) {
      bottomNav.innerHTML = "";
      // Pinned tabs vary by complexity mode
      const pinned = isBasic
        ? ["follow","overview","maps","settings"]
        : ["follow","overview","maps","calibration"];
      for (const pid of pinned) {
        const mi = MENU.find(x => x[0] === pid);
        if (!mi) continue;
        const color = MENU_COLORS[pid] || "#37588f";
        const isActive = this.state.view === pid;
        const btn = document.createElement("button");
        btn.className = "mobile-bottom-nav-btn" + (isActive ? " active" : "");
        btn.style.cssText = `--navcolor:${color}`;
        btn.innerHTML = `<span class="bn-dot" style="background:${color}"></span><span>${esc(mi[1])}</span>`;
        btn.addEventListener("click", () => _switchView(pid));
        bottomNav.appendChild(btn);
      }
      // "More" button opens the sidebar drawer
      const moreBtn = document.createElement("button");
      moreBtn.className = "mobile-bottom-nav-btn";
      moreBtn.style.cssText = "--navcolor:#78909c";
      // Highlight "More" if the current view isn't one of the pinned tabs
      if (!pinned.includes(this.state.view)) {
        moreBtn.classList.add("active");
        moreBtn.style.cssText = `--navcolor:${MENU_COLORS[this.state.view] || "#78909c"}`;
      }
      moreBtn.innerHTML = `<span class="bn-dot" style="background:#78909c"></span><span>More</span>`;
      moreBtn.addEventListener("click", () => {
        if (this.$("#app").classList.contains("mobile-open")) {
          if (this._closeDrawer) this._closeDrawer();
        } else {
          this.$("#app").classList.add("mobile-open");
          this.$("#sideBackdrop").classList.add("active");
        }
      });
      bottomNav.appendChild(moreBtn);
    }

    // ── Mobile topbar: update title and pills ───────────────────────
    const mobileTitle = this.shadowRoot.querySelector("#mobileTitle");
    if (mobileTitle) {
      const mi = MENU.find(x => x[0] === this.state.view);
      mobileTitle.textContent = mi ? mi[1] : this.state.view;
    }
    const mobileDataPill = this.shadowRoot.querySelector("#mobileDataPill");
    if (mobileDataPill) {
      const isLive = this.state.dataMode === "live";
      mobileDataPill.textContent = isLive ? "Live" : "Sample";
      mobileDataPill.className = "mobile-topbar-pill" + (isLive ? " live" : "");
    }
    const mobileModePill = this.shadowRoot.querySelector("#mobileModePill");
    if (mobileModePill) {
      mobileModePill.textContent = isBasic ? "Basic" : this.state.complexity === "development" ? "Dev" : "Adv";
      mobileModePill.className = "mobile-topbar-pill" + (isBasic ? " basic" : "");
    }
  }

  /** Open a help modal for the given key (content loaded from help_content.js). */
  _showHelp(key){
    const h = HELP[key];
    if(!h){ this._toast("No help entry for: " + key, false); return; }
    const body = document.createElement("div");
    body.style.cssText = "line-height:1.75;font-size:14px";
    const paras = Array.isArray(h.body) ? h.body : [h.body];
    for(const p of paras){
      const d = document.createElement("div");
      d.style.cssText = "margin-bottom:12px;color:#cbd5e1";
      d.textContent = p;
      body.appendChild(d);
    }
    this._openModal(h.title, body, "");
  }

  // ── Context Object (ctx) ────────────────────────────────────────────────────
  // Every view's render(ctx) receives this object. It provides:
  //   ctx.hass     — the HA hass object (for callWS, states, etc.)
  //   ctx.state    — the full application state (read-only by convention)
  //   ctx.helpers  — pure utility functions (el, esc, roomColor, etc.)
  //   ctx.actions  — mutation methods that update state + trigger re-renders
  //   ctx.toast    — show a temporary notification message
  //
  // This pattern keeps views as pure render functions with no direct access
  // to the PadSpanHaApp instance, making them easier to test and reason about.
  _ctx(){
    const self = this;
    return {
      hass: this._hass,
      state: this.state,
      helpers: {
        el, esc, pill,
        HELP,
        mapImageUrl,
        radioShortId,
        awayTimeoutS,
        isAway,
        /** Map source → friendly name from live radios. Returns "" if no name or same as source. */
        radioName: (source)=>{
          const s = String(source || "");
          const radios = (self.state.live?.snapshot?.ble?.radios) || [];
          const r = radios.find(r => String(r.source || "") === s);
          return (r && r.name && r.name !== s) ? r.name : "";
        },
        scannerStatus,
        roomColor: (n)=>roomColor(n, this.state.model),
        helpBtn: (key)=>{
          const b = document.createElement("button");
          b.className = "btn-help";
          b.title = "Help";
          b.textContent = "?";
          b.addEventListener("click", (e)=>{ e.stopPropagation(); self._showHelp(key); });
          return b;
        },
        /** Set of uppercase addresses/sources belonging to known BLE scanners.
         *  Use to filter scanners out of object/tracking views. */
        scannerAddrs: ()=>{
          const s = new Set();
          const radios = (self.state.live?.snapshot?.ble?.radios) || [];
          for(const r of radios){
            if(r.source) s.add(String(r.source).toUpperCase());
            if(r.name) s.add(String(r.name).toUpperCase());
          }
          return s;
        },
        /** Returns true if this object is a known scanner (not a trackable device). */
        isScanner: (obj)=>{
          const radios = (self.state.live?.snapshot?.ble?.radios) || [];
          const addr = (obj.address || "").toUpperCase();
          const name = (obj.name || "").toUpperCase();
          const eid = (obj.entity_id || "").toUpperCase();
          for(const r of radios){
            const rs = (r.source || "").toUpperCase();
            const rn = (r.name || "").toUpperCase();
            if(rs && (rs === addr || rs === eid || rs === name)) return true;
            if(rn && (rn === addr || rn === name)) return true;
            // Match by MAC in source against any of the object's addresses
            if(rs && Array.isArray(obj.all_addresses)){
              for(const a of obj.all_addresses){ if(a && String(a).toUpperCase() === rs) return true; }
            }
          }
          return false;
        },
      },
      // ── Actions ──────────────────────────────────────────────────────────
      // All state mutations flow through these action methods.
      // Views call ctx.actions.xyz() which updates state, makes WS calls,
      // and triggers re-renders as needed. Grouped by domain below.
      actions: {
        // Re-render triggers (views call these after local UI changes)
        renderRooms: ()=>this._scheduleRender(),
        renderNav: ()=>this._renderNav(),
        // Targeted tag-list re-render — avoids a full view rebuild which would
        // cause infinite loops in the Objects view's search/filter interaction
        renderTags: (target=null)=>{
          const node = target || this.shadowRoot?.querySelector("#content #tags");
          if(!node) return;
          try { VIEWS.objects?.renderTags?.(this._ctx(), node); } catch (e) { console.error(e); }
        },
        renderDiag: ()=>this._scheduleRender(),
        // Modal used by Overview/Objects drilldowns
        openModal: (title, bodyNode, subtitle="")=>this._openModal(title, bodyNode, subtitle),
        closeModal: ()=>this._closeModal(),
        callWS: (payload)=>this._callWS(payload),

        // Vendor lookup (online, cached server-side)
        vendorLookup: async (mac, force_refresh=false)=>{
          return await this._callWS({ type:"padspan_ha/vendor_lookup", mac, force_refresh: !!force_refresh });
        },

        // Object label actions (tag/untag BLE devices)
        objectLabelSet: async (address, label)=>{
          const res = await this._callWS({ type:"padspan_ha/object_label_set", address, label });
          // Duplicate-label guard: the same label on two devices merges them
          // into one HA device with doubled sensors — warn so the user picks
          // a unique name instead of silently colliding.
          if (res && res.warning) this._toast(res.warning, true);
          return res;
        },
        objectLabelDelete: async (address)=>{
          return await this._callWS({ type:"padspan_ha/object_label_delete", address });
        },
        objectLabelList: async ()=>{
          return await this._callWS({ type:"padspan_ha/object_label_list" });
        },
        tagObjectPrompt: (addr, currentLabel)=>this._tagObjectPrompt(addr, currentLabel),
        radioAreaSet: async (payload)=>await this._callWS({ type:"padspan_ha/radio_area_set", ...payload }),
        radioLostSet: async (source, lost)=>await this._callWS({ type:"padspan_ha/radio_lost_set", source, lost }),
        radioDisabledSet: async (source, disabled)=>await this._callWS({ type:"padspan_ha/radio_disabled_set", source, disabled }),
        // radioReset: full reset + re-fetch + re-render (use for user-initiated resets)
        radioReset: async (source)=>{ const r = await this._callWS({ type:"padspan_ha/radio_reset", source }); await this._getLiveSnapshot(); await this._loadSettings(); this._scheduleRender(); return r; },
        // radioResetQuiet: WS-only reset with no re-render — use in async UI flows
        // (e.g. calibration) where the caller manages rendering separately
        radioResetQuiet: async (source)=>{ return await this._callWS({ type:"padspan_ha/radio_reset", source }); },
        refreshSnapshot: async ()=>{ await this._getLiveSnapshot(); this._scheduleRender(); },
        refreshSnapshotQuiet: async ()=>{ await this._getLiveSnapshot(); },
        clearSessionEvents: ()=>{ this.state._sessionEvents.length = 0; this._scheduleRender(); },
        followAlertSave: async (payload)=>await this._callWS({ type:"padspan_ha/follow_alert_save", ...payload }),
        followAlertDelete: async (addr)=>{
          await this._callWS({ type:"padspan_ha/follow_alert_delete", addr });
          delete this.state.followAlertConfig[addr];
        },
        followAlertGet: async ()=>{
          try {
            const res = await this._callWS({ type:"padspan_ha/follow_alert_get" });
            if(res && res.configs) this.state.followAlertConfig = res.configs;
          } catch(e){ /* non-fatal */ }
        },
        showHelp: (key)=>this._showHelp(key),

        // Area / entity management
        areaDelete: async (area_id) =>
            await this._callWS({ type: "padspan_ha/area_delete", area_id }),
        entityDelete: async (entity_id) =>
            await this._callWS({ type: "padspan_ha/entity_delete", entity_id }),
        roomTagPurgeMissing: async () =>
            await this._callWS({ type: "padspan_ha/room_tag_purge_missing" }),
        integrationReload: async () =>
            await this._callWS({ type: "padspan_ha/integration_reload" }),
        factoryReset: async () => {
            const res = await this._callWS({ type: "padspan_ha/factory_reset", confirm: "FACTORY RESET" });
            // Clear frontend-side localStorage caches so stale data doesn't survive reload
            try { localStorage.removeItem("padspan_followed"); } catch(e){}
            try { localStorage.removeItem("padspan_followAddr"); } catch(e){}
            try { localStorage.removeItem("padspan_hiddenMapIds"); } catch(e){}
            // Reset in-memory followed state immediately
            this.state.followedAddrs = new Set();
            this.state.followAddr = "";
            // Allow _fetchSettings to overwrite followedAddrs from server on next refresh
            this._followedLoadedFromServer = false;
            // Clear cached snapshot so stale objects with labels/followed don't linger
            this.state.live = { snapshot: null, error: null };
            return res;
        },
        refreshAll: async () => { await this._refreshAll(false); },
        modelRefresh: async () => { await this._getModel(); this._scheduleRender(); },

        // Detail modals
        showObjectDetail: (obj) => this._showObjectDetail(obj),
        showRoomDetail: (roomName) => this._showRoomDetail(roomName),
        showScannerDetail: (scanner) => this._showScannerDetail(scanner),

        // Mapping suite actions
        setMapsTab: (t)=>{
          this.state.mapsTab = t;
          // Opt-in usage report. This called a telemetryEvent() helper off
          // `this.actions`,
          // and `this.actions` has never existed on the element — the actions
          // live on the ctx object handed to views. So EVERY Mapping sub-tab
          // click threw a TypeError here, before reaching the render below.
          // The tab state changed and the screen never redrew, which is what
          // "the Mapping tabs don't load" was: not a hang, a swallowed throw
          // leaving the previous tab's DOM on screen.
          //
          // Matches the guarded, non-throwing call _switchView already uses.
          // Nothing leaves the browser unless the report is switched on.
          if (this.state.settings && this.state.settings.telemetry_enabled) {
            this._callWS({ type: "padspan_ha/telemetry_event", event: "tab:maps/" + t }).catch(() => {});
          }
          if (t === "library") this._getMapsList().then(()=>this._scheduleRender()).catch(()=>this._scheduleRender());
          else this._scheduleRender();
        },
        mapsRefresh: async ()=>{ await this._getMapsList(); this._scheduleRender(); },
        mapsSetActive: (id)=>{ this.state.activeMapId=id; this._scheduleRender(); },
        mapsDelete: async (id)=>{ await this._callWS({ type:"padspan_ha/maps_delete", map_id:id }); await this._getMapsList(); if(this.state.activeMapId===id) this.state.activeMapId=null; this._scheduleRender(); },
        mapsDeleteMigrate: async (mapId, targetMapId, extendCanvas=false)=>{ const r = await this._callWS({ type:"padspan_ha/maps_delete_migrate", map_id:mapId, target_map_id:targetMapId, extend_canvas:!!extendCanvas }); await this._getMapsList(); if(this.state.activeMapId===mapId) this.state.activeMapId=null; this._scheduleRender(); return r; },
        mapsUpload: async (payload)=>{ const r = await this._callWS(Object.assign({type:"padspan_ha/maps_upload"}, payload)); await this._getMapsList(); return r; },
        mapsUpdate: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/maps_update"}, payload)); await this._getMapsList(); this._scheduleRender(); },
        mapsUpdateQuiet: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/maps_update"}, payload)); },
        mapsRefreshQuiet: async ()=>{ await this._getMapsList(); },
        mapsReplaceImage: async (payload)=>{ const res = await this._callWS(Object.assign({type:"padspan_ha/maps_replace_image"}, payload)); await this._getMapsList(); this._scheduleRender(); return res; },
        modelUpdate: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/model_update"}, payload)); await this._getModel(); this._scheduleRender(); },

        // Settings actions
        settingsSet: async (payload) => {
          // Do NOT bundle data_mode here: this.state.dataMode defaults to
          // "sample" until settings load, so echoing it back can silently
          // flip a live install into sample mode (backend keeps data_mode
          // untouched when the message omits it).
          const res = await this._callWS(Object.assign({ type: "padspan_ha/settings_set" }, payload));
          this.state.settings = res?.settings || this.state.settings;
          this._applyTheme();
          this._applySkin();
          this._renderNav();
          this._scheduleRender();
          return res;
        },
        scannerOffsetSet: async (source, offset_db) => {
          const res = await this._callWS({ type: "padspan_ha/scanner_offset_set", source, offset_db });
          await this._getLiveSnapshot();
          await this._loadSettings();
          return res;
        },
        // BLE calibration actions
        calibrationGet: async () => await this._callWS({ type: "padspan_ha/calibration_get" }),
        calibrationSavePoint: async (point) => await this._callWS({ type: "padspan_ha/calibration_save_point", point }),
        calibrationDeletePoint: async (point_id) => await this._callWS({ type: "padspan_ha/calibration_delete_point", point_id }),
        calibrationClear: async () => await this._callWS({ type: "padspan_ha/calibration_clear" }),
        calibrationClearMap: async (map_id) => await this._callWS({ type: "padspan_ha/calibration_clear_map", map_id }),
        objectEvict: async (key) => await this._callWS({ type: "padspan_ha/object_evict", key }),
        calibrationComputeModel: async () => await this._callWS({ type: "padspan_ha/calibration_compute_model" }),
        calibrationSwapRadio: async (old_source, new_source) => await this._callWS({ type: "padspan_ha/calibration_swap_radio", old_source, new_source }),
        calibrationRelearnRadio: async (source, gain_db) => {
          const res = await this._callWS({ type: "padspan_ha/calibration_relearn_radio", source, gain_db });
          await this._getLiveSnapshot();
          return res;
        },
        calibrationHealthCheck: async () => await this._callWS({ type: "padspan_ha/calibration_health_check" }),
        wsCall: async (type, data={}) => await this._callWS({ type, ...data }),
        // Opt-in usage report: count one allow-listed event. A no-op unless the
        // person turned the report on — no traffic leaves the browser otherwise.
        telemetryEvent: (name) => {
          if (!(this.state.settings && this.state.settings.telemetry_enabled)) return;
          this._callWS({ type: "padspan_ha/telemetry_event", event: String(name) }).catch(() => {});
        },
        // ── Followed Beacons ──────────────────────────────────────────────
        // Multi-device follow set — persisted both to server (via settings_set)
        // and to localStorage as a fallback. Addresses are stored uppercase.
        followedHas: (addr) => !!addr && this.state.followedAddrs.has(String(addr).toUpperCase()),
        followedToggle: (addr) => {
          if(!addr) return;
          const key = String(addr).toUpperCase();
          if(this.state.followedAddrs.has(key)){
            this.state.followedAddrs.delete(key);
          } else {
            this.state.followedAddrs.add(key);
          }
          // Persist to server (fire-and-forget)
          this._callWS({
            type: "padspan_ha/settings_set",
            followed_addrs: [...this.state.followedAddrs],
          }).catch(()=>{});
          // Also mirror to localStorage as fallback
          try { localStorage.setItem("padspan_followed", JSON.stringify([...this.state.followedAddrs])); } catch(e){}
          this._scheduleRender();
        },
      },
      toast: (m, isErr=false)=>this._toast(m, isErr),
    };
  }

  // ── Modal System ────────────────────────────────────────────────────────────
  // Overlay modal used by detail views (object detail, room detail, scanner detail)
  // and by the tag/rename prompt. Built with raw DOM — no framework dependency.
  // ESC key and clicking the overlay backdrop both close the modal.
  _openModal(title, bodyNode, subtitle=""){
    if(!this.$modal) return;
    this.$modal.classList.remove("hidden");
    this.$modal.innerHTML = "";

    const overlay = el("div",{class:"overlay"});
    const panel = el("div",{class:"panel"});

    const closeBtn = el("button",{class:"btn inline close"}, "Close");
    closeBtn.addEventListener("click", ()=>this._closeModal());

    const head = el("div",{class:"head"},[
      el("div",{class:"title"}, title || ""),
      el("div",{class:"sub"}, subtitle || ""),
      closeBtn
    ]);

    const body = el("div",{class:"body"});
    if(typeof bodyNode === "string"){
      body.innerHTML = bodyNode;
    } else if(bodyNode){
      body.appendChild(bodyNode);
    }

    panel.appendChild(head);
    panel.appendChild(body);
    overlay.appendChild(panel);

    overlay.addEventListener("click",(e)=>{ if(e.target === overlay) this._closeModal(); });
    this.$modal.appendChild(overlay);

    // ESC closes — remove stale handler before registering new one
    if(this._modalEsc) window.removeEventListener("keydown", this._modalEsc);
    const esc = (e)=>{ if(e.key === "Escape"){ this._closeModal(); } };
    this._modalEsc = esc;
    window.addEventListener("keydown", esc, { once: true });
  }

  _closeModal(){
    if(!this.$modal) return;
    this.$modal.classList.add("hidden");
    this.$modal.innerHTML = "";
  }


  // ── Tag/Rename Prompt ───────────────────────────────────────────────────────
  // Opens a modal with an input field to assign or update a human-readable label
  // on a BLE device. Labels are stored server-side via object_label_set and
  // appear throughout the UI wherever the device's address would normally show.
  _tagObjectPrompt(addr, currentLabel){
    const input = el("input",{type:"text", placeholder:"Enter a label…", maxLength:48});
    input.value = currentLabel || "";
    input.style.minWidth = "min(240px, 100%)";

    const status = el("div",{class:"muted", style:"min-height:20px;margin-top:6px"});

    const saveBtn = el("button",{class:"btn"}, currentLabel ? "Update label" : "Save label");
    const clearBtn = el("button",{class:"btn"}, "Untag");
    clearBtn.disabled = !currentLabel;
    clearBtn.title = currentLabel ? `Remove label "${currentLabel}"` : "No label to remove";
    const cancelBtn = el("button",{class:"btn inline"}, "Cancel");
    cancelBtn.addEventListener("click", ()=>this._closeModal());

    saveBtn.addEventListener("click", async ()=>{
      const label = input.value.trim();
      if(!label){ status.textContent = "Label cannot be empty."; return; }
      try {
        await this._callWS({ type:"padspan_ha/object_label_set", address: addr, label });
        this._logEvent("tag", `${addr} → ${label}`);
        this._closeModal();
        this._toast(`Tagged: ${label}`);
        await this._getLiveSnapshot();
        this._scheduleRender();
      } catch(e) {
        status.textContent = "Failed to save label. Check HA logs.";
      }
    });

    clearBtn.addEventListener("click", async ()=>{
      try {
        await this._callWS({ type:"padspan_ha/object_label_delete", address: addr });
        this._logEvent("tag", `${addr} untagged`);
        this._closeModal();
        this._toast("Label removed.");
        await this._getLiveSnapshot();
        this._scheduleRender();
      } catch(e) {
        status.textContent = "Failed to remove label. Check HA logs.";
      }
    });

    // Allow Enter key to save
    input.addEventListener("keydown",(e)=>{ if(e.key==="Enter") saveBtn.click(); });

    const body = el("div",{}, [
      el("div",{class:"muted", style:"margin-bottom:8px"}, `BLE address: ${addr}`),
      el("div",{class:"row", style:"gap:8px;flex-wrap:wrap"}, [input, saveBtn, clearBtn, cancelBtn]),
      status,
    ]);
    this._openModal("Tag BLE Object", body, "Assign a human-readable label to identify this device");
    // Focus input after modal renders
    requestAnimationFrame(()=>{ try{ input.focus(); }catch(e){} });
  }

  // ── Detail Modals ───────────────────────────────────────────────────────────
  // Rich detail views for objects, rooms, and scanners. These are opened from
  // Overview cards, Follow view, and anywhere a "Details" button appears.
  // Each builds a DOM tree with identity info, status, location, and actions.

  /** Look up floor name from floor_id using the model's floor list. */
  _floorName(floor_id){
    if(!floor_id) return "—";
    const floors = this.state.model?.floors || [];
    const f = floors.find(x => x.id === floor_id);
    return f ? f.name : "—";
  }

  /**
   * Show a rich detail modal for a BLE object.
   * Sections: identity (name, kind, addresses), status (RSSI, age, calibration),
   * location (room, floor, nearest receiver), detection sources table,
   * raw BLE data (manufacturer data, service UUIDs), rename form, and
   * action buttons (follow, delete, close).
   * Handles all BLE kinds: ble, private_ble, ibeacon, and HA entities.
   */
  _showObjectDetail(obj){
    const addr = obj.address || "";
    const userLabel = obj.user_label || "";
    const name = userLabel || obj.name || obj.entity_id || addr || "Unknown";
    const kind = obj.kind || "";
    const identified = !!obj.identified;

    // Canonical address for rename (varies by kind)
    const tagAddr = kind === "private_ble" ? (obj.canonical_id || addr)
                  : kind === "ibeacon"     ? (obj.key || "")
                  : addr;
    const canRename = (kind==="ble"||kind==="private_ble"||kind==="ibeacon") && !!tagAddr;


    const body = el("div", {style:"display:flex;flex-direction:column;gap:14px"});

    // Identity
    body.appendChild(el("div", {}, [
      el("div", {style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px"}, [
        el("div", {style:"font-size:20px;font-weight:800;color:#e2e8f0"}, name),
        el("span", {class:"badge"+(identified?"":" warn"), style:
          kind==="private_ble" ? (identified?"background:#1a3a5a;color:#7dd3fc;border-color:#3b82f6":"") :
          kind==="ibeacon" ? (identified?"background:#3a2a0a;color:#fbbf24;border-color:#d97706":"") : ""},
          kind==="private_ble" ? (identified?"Private BLE · Identified":"Private BLE · Unidentified") :
          kind==="ibeacon" ? (identified?"iBeacon · Identified":"iBeacon · Unidentified") :
          kind==="ble" ? (identified?"BLE · Identified":"BLE · Unidentified") : "HA Entity"),
      ]),
      addr ? el("div", {class:"muted", style:"font-family:monospace;font-size:12px"}, addr) : null,
      obj.canonical_id ? el("div", {class:"muted", style:"font-size:11px"}, `Canonical: ${obj.canonical_id}`) : null,
      (Array.isArray(obj.all_addresses) && obj.all_addresses.length > 1)
        ? el("div", {class:"muted", style:"font-size:11px"}, `Addresses (${obj.all_addresses.length}): ${obj.all_addresses.slice(0,5).join(", ")}${obj.all_addresses.length>5?" + "+(obj.all_addresses.length-5)+" more":""}`)
        : null,
      obj._dedup_reason ? el("div", {class:"muted", style:"font-size:10px;color:#a78bfa"}, `Merged: ${obj._dedup_reason}`) : null,
      obj.entity_id ? el("div", {class:"muted", style:"font-size:12px"}, `Entity: ${obj.entity_id}`) : null,
      obj.ibeacon_key ? el("div", {class:"muted", style:"font-size:11px;color:#fbbf24"}, `Linked iBeacon: ${obj.ibeacon_key}`) : null,
      (Array.isArray(obj.linked_entities) && obj.linked_entities.length)
        ? el("div", {class:"muted", style:"font-size:11px;color:#60a5fa"}, `Linked entities: ${obj.linked_entities.join(", ")}`)
        : null,
      // Enrichment badges
      (obj.company_name || obj.device_type || (obj.service_names && obj.service_names.length) || obj.connectable != null)
        ? el("div", {style:"display:flex;flex-wrap:wrap;gap:5px;margin-top:6px"}, [
            obj.company_name ? el("span",{class:"badge",style:"background:#1a2a3a;color:#7dd3fc;border-color:#1e4976"}, obj.company_name) : null,
            obj.device_type  ? el("span",{class:"badge",style:"background:#2a1a3a;color:#c4b5fd;border-color:#5b21b6"}, obj.device_type) : null,
            ...(obj.service_names || []).map(sn =>
              el("span",{class:"badge",style:"background:#1a3a2a;color:#86efac;border-color:#166534"}, sn)
            ),
            obj.connectable === true  ? el("span",{class:"badge",style:"font-size:10px"}, "Connectable") : null,
            obj.connectable === false ? el("span",{class:"badge",style:"font-size:10px;background:#2a1a0a;color:#fbbf24;border-color:#92400e"}, "Non-connectable") : null,
          ].filter(Boolean))
        : null,
    ].filter(Boolean)));

    // Status / Last seen
    {
      const statusItems = [];
      // Last seen age
      if (obj.age_s != null) {
        const ageStr = fmtAgo(obj.age_s);
        const objIsAway = isAway(obj, awayTimeoutS(this.state.settings));
        statusItems.push(el("div", {style:"display:flex;align-items:center;gap:8px"}, [
          el("span", {style:"font-weight:600"}, "Last seen:"),
          el("span", {}, ageStr + " ago"),
          objIsAway ? el("span", {class:"badge", style:"background:#3a0a0a;color:#f87171;border-color:#7f1d1d;font-size:10px"}, "Away") : null,
        ].filter(Boolean)));
      }
      // Last seen timestamp
      if (obj.last_seen) {
        try {
          const d = new Date(obj.last_seen);
          statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `Last seen: ${d.toLocaleString()}`));
        } catch(e){}
      }
      // First seen timestamp
      if (obj.first_seen) {
        try {
          const d = new Date(obj.first_seen);
          statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `First seen: ${d.toLocaleString()}`));
        } catch(e){}
      }
      // RSSI summary
      if (obj.rssi != null) {
        const pct = Math.max(0, Math.min(100, ((obj.rssi + 100) / 60) * 100));
        const bar = el("div", {style:`width:${pct.toFixed(0)}%;height:6px;background:#52b788;border-radius:3px;min-width:2px`});
        statusItems.push(el("div", {style:"display:flex;align-items:center;gap:8px;margin-top:2px"}, [
          el("span", {style:"font-weight:600"}, "Signal:"),
          el("span", {}, `${obj.rssi} dBm`),
          el("div", {style:"width:80px;background:#1a2e1e;border-radius:3px"}, bar),
        ]));
      }
      // iBeacon details
      if (kind === "ibeacon") {
        if (obj.ibeacon_uuid) statusItems.push(el("div", {class:"muted", style:"font-size:11px;font-family:monospace"}, `UUID: ${obj.ibeacon_uuid}`));
        if (obj.ibeacon_major != null) statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `Major: ${obj.ibeacon_major} · Minor: ${obj.ibeacon_minor}`));
        if (obj.tx_power != null) statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `TX Power: ${obj.tx_power} dBm (factory calibrated at 1m)`));
        // Merged protocols badge (iBeacon + Eddystone, etc.)
        if (Array.isArray(obj.merged_protocols) && obj.merged_protocols.length > 1) {
          statusItems.push(el("div", {style:"display:flex;gap:4px;flex-wrap:wrap;margin-top:2px"},
            obj.merged_protocols.map(p => el("span", {class:"badge", style:"font-size:10px;background:#2a1a3a;color:#c4b5fd;border-color:#5b21b6"}, p))
          ));
        }
        // Eddystone service data (UUID feaa)
        const svcData = obj.service_data || {};
        const eddyPayload = svcData["0000feaa-0000-1000-8000-00805f9b34fb"] || svcData["feaa"];
        if (eddyPayload) {
          statusItems.push(el("div", {style:"margin-top:4px"}, [
            el("span", {style:"font-weight:600;font-size:12px;color:#fbbf24"}, "Eddystone: "),
            el("span", {class:"muted", style:"font-family:monospace;font-size:11px"}, String(eddyPayload)),
          ]));
        }
      }
      // Private BLE details
      if (kind === "private_ble") {
        if (obj.private_ble_name) statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `Identity: ${obj.private_ble_name}`));
        if (Array.isArray(obj.all_addresses) && obj.all_addresses.length > 1)
          statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `Active rotating MACs: ${obj.all_addresses.length}`));
      }
      // KNN calibration confidence
      if (obj.knn_confidence > 0) {
        statusItems.push(el("div", {style:"display:flex;align-items:center;gap:8px;margin-top:2px"}, [
          el("span", {style:"font-weight:600"}, "Calibrated:"),
          el("span", {style:"color:#52b788"}, `${Math.round(obj.knn_confidence * 100)}% confidence`),
        ]));
      }
      if (statusItems.length) {
        body.appendChild(el("div", {}, [
          el("div", {style:"font-weight:600;margin-bottom:4px"}, "Status"),
          ...statusItems,
        ]));
      }
    }

    // Location — an away object is shown as where it was LAST, not where it is.
    const _objAway = isAway(obj, awayTimeoutS(this.state.settings));
    // A departed object has no current room; the snapshot moves where it was
    // last seen to last_room.
    const objRoom = obj.room || obj.last_room || "—";
    const haArea = (this.state.model?.areas||[]).find(a => a.name === objRoom);
    const floorName = haArea ? this._floorName(haArea.floor_id) : "—";
    const rc = roomColor(objRoom, this.state.model);
    body.appendChild(el("div", {}, [
      el("div", {style:"font-weight:600;margin-bottom:4px"}, _objAway ? "Last location" : "Location"),
      el("div", {style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap"}, [
        el("span", {class:"dot", style:`background:${rc}`}),
        el("span", {}, objRoom),
        el("span", {class:"muted"}, `· ${floorName}`),
      ]),
      obj.nearest_receiver ? el("div", {class:"muted", style:"font-size:12px;margin-top:4px"}, `Nearest: ${obj.nearest_receiver}`) : null,
    ].filter(Boolean)));

    // Detection sources table
    const sources = obj.sources || [];
    // Build source→name lookup from live radios so we show friendly names
    const _radioMap = {};
    const _radios = this.state.live?.snapshot?.ble?.radios || [];
    for(const r of _radios){
      if(r.source) _radioMap[r.source] = r.name || r.source;
    }
    const _friendlySource = (src) => _radioMap[src] || src || "—";
    const makeSourceRow = (srcName, rssi, age_s) => {
      const pct = Math.max(0, Math.min(100, ((rssi ?? -100) + 100) / 60 * 100));
      const bar = el("div", {style:`width:${pct.toFixed(0)}%;height:6px;background:#52b788;border-radius:3px;min-width:2px`});
      const barWrap = el("div", {style:"width:80px;background:#1a2e1e;border-radius:3px"}, bar);
      return el("tr", {}, [
        el("td", {style:"font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis"}, _friendlySource(srcName)),
        el("td", {}, barWrap),
        el("td", {}, rssi != null ? `${rssi}` : "—"),
        el("td", {class:"muted", style:"font-size:11px"}, fmtAgo(age_s)),
      ]);
    };
    if(sources.length || obj.rssi != null){
      const tbody = el("tbody");
      if(sources.length){
        for(const s of sources){
          const srcName = typeof s === "string" ? s : (s.source || "");
          const rssi = typeof s === "object" ? s.rssi : obj.rssi;
          const age_s = typeof s === "object" ? s.age_s : obj.age_s;
          tbody.appendChild(makeSourceRow(srcName, rssi, age_s));
        }
      } else {
        tbody.appendChild(makeSourceRow(obj.source || "unknown", obj.rssi, obj.age_s));
      }
      const srcSection = el("div", {}, [
        el("div", {style:"font-weight:600;margin-bottom:6px"}, "Detection sources"),
        el("table", {class:"table"}, [
          el("thead", {}, el("tr", {}, [el("th",{},"Source"),el("th",{},"Signal"),el("th",{},"dBm"),el("th",{},"Age")])),
          tbody,
        ]),
      ]);
      body.appendChild(srcSection);
    }

    // Device info
    if(obj.device && (obj.device.manufacturer || obj.device.model || obj.device.name)){
      const dev = obj.device;
      body.appendChild(el("div", {}, [
        el("div", {style:"font-weight:600;margin-bottom:4px"}, "Device"),
        el("div", {class:"muted", style:"font-size:12px"}, [dev.manufacturer, dev.model].filter(Boolean).join(" · ") || dev.name || ""),
      ]));
    }

    // Raw BLE data (collapsible)
    const manufData = obj.manufacturer_data || {};
    const svcData = obj.service_data || {};
    const svcUUIDs = obj.service_uuids || [];
    const svcUuidMap = obj.service_uuid_map || {};
    if((kind==="ble"||kind==="private_ble"||kind==="ibeacon") && (Object.keys(manufData).length || Object.keys(svcData).length || svcUUIDs.length)){
      const det = document.createElement("details");
      det.style.cssText = "margin-top:4px";
      const sum = document.createElement("summary");
      sum.style.cssText = "cursor:pointer;font-weight:600;font-size:13px;color:#52b788";
      sum.textContent = "Raw BLE data";
      det.appendChild(sum);
      if(Object.keys(manufData).length){
        det.appendChild(el("div", {style:"font-size:12px;color:#94a3b8;margin-top:8px"}, "Manufacturer data:"));
        det.appendChild(el("table", {class:"table", style:"margin-top:4px"}, [
          el("thead", {}, el("tr", {}, [el("th",{},"Company ID"),el("th",{},"Company"),el("th",{},"Payload (hex)")])),
          el("tbody", {}, Object.entries(manufData).map(([k,v]) =>
            el("tr", {}, [
              el("td",{},String(k)),
              el("td",{style:"font-size:11px;color:#7dd3fc"}, obj.company_name && String(k) === Object.keys(manufData)[0] ? obj.company_name : "—"),
              el("td",{class:"muted",style:"font-family:monospace;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis"},String(v)),
            ])
          )),
        ]));
      }
      if(Object.keys(svcData).length){
        det.appendChild(el("div", {style:"font-size:12px;color:#94a3b8;margin-top:8px"}, "Service data:"));
        det.appendChild(el("table", {class:"table", style:"margin-top:4px"}, [
          el("thead", {}, el("tr", {}, [el("th",{},"Service UUID"),el("th",{},"Name"),el("th",{},"Payload (hex)")])),
          el("tbody", {}, Object.entries(svcData).map(([k,v]) => {
            const uKey = String(k).toLowerCase();
            const sName = svcUuidMap[uKey] || svcUuidMap[k] || (uKey.includes("feaa") ? "Eddystone" : "—");
            return el("tr", {}, [
              el("td",{style:"font-size:11px;font-family:monospace"},String(k)),
              el("td",{style:"font-size:11px;color:#fbbf24"}, sName),
              el("td",{class:"muted",style:"font-family:monospace;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis"},String(v)),
            ]);
          })),
        ]));
      }
      if(svcUUIDs.length){
        det.appendChild(el("div", {style:"font-size:12px;color:#94a3b8;margin-top:8px"}, "Service UUIDs:"));
        det.appendChild(el("div", {style:"margin-top:4px;display:flex;flex-wrap:wrap;gap:6px"},
          svcUUIDs.map(u => {
            const uStr = String(u);
            const svcName = svcUuidMap[uStr];
            const label = svcName ? `${uStr} (${svcName})` : uStr;
            return el("span", {class:"pill"}, label);
          })
        ));
      }
      body.appendChild(det);
    }

    // Linked entities
    const linked = obj.linked_entities || [];
    if(linked.length){
      body.appendChild(el("div", {}, [
        el("div", {style:"font-weight:600;margin-bottom:4px"}, "Linked entities"),
        el("div", {style:"display:flex;flex-wrap:wrap;gap:6px"}, linked.map(eid => el("span", {class:"pill"}, eid))),
      ]));
    }

    // Inline rename section (BLE / private_ble / ibeacon)
    if(canRename){
      const renameInput = el("input",{type:"text",placeholder:"Enter a label…",style:"flex:1;min-width:160px"});
      renameInput.value = userLabel;
      const renameStatus = el("div",{class:"muted",style:"min-height:16px;font-size:12px;margin-top:4px"});
      const saveRenameBtn = el("button",{class:"btn"}, userLabel ? "Update" : "Tag");
      saveRenameBtn.addEventListener("click", async()=>{
        const label = renameInput.value.trim();
        if(!label){ renameStatus.textContent = "Label cannot be empty."; return; }
        try {
          await this._callWS({ type:"padspan_ha/object_label_set", address: tagAddr, label });
          this._closeModal();
          this._toast(`Renamed: ${label}`);
          await this._getLiveSnapshot();
          this._scheduleRender();
        } catch(e){ renameStatus.textContent = "Failed to save. Check HA logs."; }
      });
      renameInput.addEventListener("keydown",(e)=>{ if(e.key==="Enter") saveRenameBtn.click(); });
      const renameRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center"},[renameInput, saveRenameBtn]);
      if(userLabel){
        const untagBtn = el("button",{class:"btn"}, "Untag");
        untagBtn.addEventListener("click", async()=>{
          try {
            await this._callWS({ type:"padspan_ha/object_label_delete", address: tagAddr });
            this._closeModal();
            this._toast("Label removed.");
            await this._getLiveSnapshot();
            this._scheduleRender();
          } catch(e){ renameStatus.textContent = "Failed to remove label."; }
        });
        renameRow.appendChild(untagBtn);
      }
      body.appendChild(el("div",{style:"padding-top:12px;border-top:1px solid #1b3526;margin-top:4px"},[
        el("div",{style:"font-weight:600;margin-bottom:6px"}, "Rename"),
        renameRow,
        renameStatus,
      ]));
      requestAnimationFrame(()=>{ try{ renameInput.focus(); }catch(e){} });
    }

    // Actions row
    const actionsRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;padding-top:8px;border-top:1px solid #1b3526;margin-top:8px"});
    // Follow toggle (multi-device Set)
    const _followKey = (addr || obj.entity_id || "").toUpperCase();
    if(_followKey){
      const _isFollowed = this.state.followedAddrs.has(_followKey);
      const followBtn = el("button",{
        class:"btn inline",
        style: _isFollowed ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "",
      }, _isFollowed ? "Following" : "Follow");
      followBtn.addEventListener("click", ()=>{
        const wasFollowed = this.state.followedAddrs.has(_followKey);
        if(wasFollowed) this.state.followedAddrs.delete(_followKey);
        else this.state.followedAddrs.add(_followKey);
        // Persist to server
        this._callWS({
          type: "padspan_ha/settings_set",
          followed_addrs: [...this.state.followedAddrs],
        }).catch(()=>{});
        try { localStorage.setItem("padspan_followed", JSON.stringify([...this.state.followedAddrs])); } catch(e){}
        const nowFollowed = this.state.followedAddrs.has(_followKey);
        followBtn.textContent = nowFollowed ? "Following" : "Follow";
        followBtn.style.cssText = nowFollowed
          ? "width:auto;margin-top:0;background:#1a3a2a;border-color:#52b788;color:#52b788" : "width:auto;margin-top:0";
      });
      actionsRow.appendChild(followBtn);
    }
    // Delete button — unfollow + remove label + purge from view
    if(_followKey || canRename){
      const deleteBtn = el("button",{
        class:"btn inline",
        style:"background:#3b1219;border-color:#f87171;color:#f87171",
      }, "Delete");
      deleteBtn.addEventListener("click", async()=>{
        // Unfollow
        if(_followKey && this.state.followedAddrs.has(_followKey)){
          this.state.followedAddrs.delete(_followKey);
          this._callWS({
            type: "padspan_ha/settings_set",
            followed_addrs: [...this.state.followedAddrs],
          }).catch(()=>{});
          try { localStorage.setItem("padspan_followed", JSON.stringify([...this.state.followedAddrs])); } catch(e){}
        }
        // Remove label
        if(canRename && tagAddr){
          try { await this._callWS({ type:"padspan_ha/object_label_delete", address: tagAddr }); } catch(e){}
        }
        this._closeModal();
        this._toast("Deleted: " + (userLabel || name));
        await this._getLiveSnapshot();
        this._scheduleRender();
      });
      actionsRow.appendChild(deleteBtn);
    }
    actionsRow.appendChild(el("button",{class:"btn inline",onclick:()=>this._closeModal()}, "Close"));
    body.appendChild(actionsRow);

    this._openModal(name, body, kind==="ble" ? `BLE object · ${identified?"identified":"unidentified"}` : "HA entity");
  }

  /** Show a detail modal for a room: objects currently in it, assigned scanners, HA entities. */
  _showRoomDetail(roomName){
    const snap = this.state.live?.snapshot;
    // "Objects currently in this room" is present tense. An object keeps its
    // last known room forever so a dropout does not erase where it was, but
    // listing a departed one here says it is still standing there — a car gone
    // for an hour stayed in the Garage while its own entities read not_home.
    const _awayS = awayTimeoutS(this.state.settings);
    const objects = (snap?.objects?.list||[])
      .filter(o => o.room === roomName && !isAway(o, _awayS));
    const radios = (snap?.ble?.radios||[]).filter(r => r.area_name === roomName || r.area === roomName);
    const area = (this.state.model?.areas||[]).find(a => a.name === roomName);
    const floorName = area ? this._floorName(area.floor_id) : "—";
    const rc = roomColor(roomName, this.state.model);

    const body = el("div", {style:"display:flex;flex-direction:column;gap:14px"});

    // Header with color swatch + floor
    body.appendChild(el("div", {style:"display:flex;align-items:center;gap:10px"}, [
      el("span", {style:`display:inline-block;width:20px;height:20px;border-radius:50%;background:${rc};flex-shrink:0`}),
      el("div", {}, [
        el("div", {style:"font-weight:700;font-size:16px"}, roomName),
        el("div", {class:"muted", style:"font-size:12px"}, `Floor: ${floorName}`),
      ]),
    ]));

    // Objects in room
    const objSection = el("div", {}, [
      el("div", {style:"font-weight:600;margin-bottom:6px"}, `Objects now (${objects.length})`),
    ]);
    if(objects.length){
      for(const o of objects){
        const oName = o.user_label || o.name || o.entity_id || o.address || "Unknown";
        const oKey = (o.address || o.entity_id || "").toUpperCase();
        const isFollowed = oKey && this.state.followedAddrs.has(oKey);
        const oc = isFollowed ? "#fbbf24" : (o.identified ? "#5eead4" : "#f59e0b");
        const rssiTxt = o.rssi != null ? `${o.rssi} dBm` : "";
        const ageTxt = o.age_s != null ? fmtAgo(o.age_s) : "";
        const oRow = el("div", {style:"display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #0d1f12"}, [
          el("span", {style:`width:8px;height:8px;border-radius:50%;background:${oc};flex-shrink:0`}),
          el("div", {style:"flex:1"}, oName),
          isFollowed ? el("span", {class:"badge", style:"background:#fbbf2422;color:#fbbf24;border-color:#fbbf24"}, "Following") : null,
          rssiTxt ? el("span", {class:"badge"}, rssiTxt) : null,
          ageTxt ? el("span", {class:"muted", style:"font-size:11px"}, ageTxt) : null,
          el("button", {class:"btn tiny", onclick:()=>{ this._closeModal(); this._showObjectDetail(o); }}, "Details"),
        ].filter(Boolean));
        objSection.appendChild(oRow);
      }
    } else {
      objSection.appendChild(el("div", {class:"muted", style:"font-size:12px"}, "No objects currently detected in this room."));
    }
    body.appendChild(objSection);

    // Radios in room
    const radioSection = el("div", {}, [
      el("div", {style:"font-weight:600;margin-bottom:6px"}, `Bluetooth scanners (${radios.length})`),
    ]);
    if(radios.length){
      for(const r of radios){
        const rName = r.name || r.source || "Scanner";
        const sid = radioShortId(r.source || "");
        const rRow = el("div", {style:"display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #0d1f12"}, [
          el("span", {style:"font-family:monospace;font-weight:700;font-size:12px;letter-spacing:.04em;color:#52b788;flex-shrink:0"}, sid),
          el("div", {style:"flex:1"}, [
            el("div", {}, rName),
            r.source ? el("div", {class:"muted", style:"font-size:11px;font-family:monospace"}, r.source) : null,
          ].filter(Boolean)),
          (()=>{ const ss = scannerStatus(r, snap?.ble?.advertisements); const b = el("span",{class:ss.cls,title:ss.title},ss.label); if(ss.style) b.style.cssText+=ss.style; return b; })(),
          el("button", {class:"btn tiny", onclick:()=>{ this._closeModal(); this._showScannerDetail(r); }}, "Details"),
        ].filter(Boolean));
        radioSection.appendChild(rRow);
      }
    } else {
      radioSection.appendChild(el("div", {class:"muted", style:"font-size:12px"}, "No Bluetooth scanners assigned to this room."));
    }
    body.appendChild(radioSection);

    // HA Entities
    const entities = Object.keys(this.state.roomTagMap?.[roomName] || {});
    if(entities.length){
      body.appendChild(el("div", {}, [
        el("div", {style:"font-weight:600;margin-bottom:6px"}, `HA Entities (${entities.length})`),
        el("div", {style:"display:flex;flex-wrap:wrap;gap:6px"}, entities.map(eid => el("span", {class:"pill"}, eid))),
      ]));
    }

    this._openModal(roomName, body, `Room · ${floorName}`);
  }

  /** Show a detail modal for a BLE scanner: status, network info, area, visible devices. */
  _showScannerDetail(scanner){
    const snap = this.state.live?.snapshot;
    const devices = (snap?.objects?.list||[]).filter(
      o => (o.sources||[]).some(s => (typeof s==="string" ? s : s.source) === scanner.source)
    ).map(o => {
      const srcEntry = (o.sources||[]).find(s => (typeof s==="string" ? s : s.source) === scanner.source);
      return {
        ...o,
        srcRssi: typeof srcEntry==="object" ? (srcEntry?.rssi ?? o.rssi) : o.rssi,
        srcAge: typeof srcEntry==="object" ? (srcEntry?.age_s ?? o.age_s) : o.age_s,
      };
    }).sort((a,b) => (b.srcRssi ?? -999) - (a.srcRssi ?? -999));

    const name = scanner.name || scanner.source || "Scanner";
    const sid  = radioShortId(scanner.source || "");
    const body = el("div", {style:"display:flex;flex-direction:column;gap:14px"});

    // Status badges (include short ID and lost status)
    const statusRow = el("div", {style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center"});
    statusRow.appendChild(el("span", {class:"pill", style:"font-family:monospace;font-weight:700;font-size:13px;letter-spacing:.04em", title: name + " \u00b7 " + (scanner.source||"")}, sid));
    if(scanner.lost)     statusRow.appendChild(el("span", {class:"badge warn", style:"background:rgba(245,158,11,.18)"}, "⚠ Lost"));
    if(scanner.disabled) statusRow.appendChild(el("span", {class:"badge warn", style:"background:rgba(148,100,220,.18);color:#c084fc"}, "⊘ Disabled"));
    { const ss = scannerStatus(scanner, snap?.ble?.advertisements); const b = el("span",{class:ss.cls,title:ss.title},ss.label); if(ss.style) b.style.cssText+=ss.style; statusRow.appendChild(b); }
    if(scanner.connectable != null) statusRow.appendChild(el("span", {class:"badge"}, scanner.connectable?"connectable":"not connectable"));
    if(scanner.adapter) statusRow.appendChild(el("span", {class:"muted", style:"font-family:monospace;font-size:12px"}, `adapter: ${scanner.adapter}`));
    body.appendChild(statusRow);

    // Network info (IP, SSID, WiFi signal)
    if(scanner.ip || scanner.ssid || scanner.wifi_signal != null || scanner.connection_type){
      const netRow = el("div", {style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center"});
      if(scanner.ip) netRow.appendChild(el("span", {class:"badge", style:"font-family:monospace;font-size:11px"}, scanner.ip));
      if(scanner.ssid) netRow.appendChild(el("span", {class:"badge", style:"font-size:11px"}, scanner.ssid));
      else if(scanner.connection_type) netRow.appendChild(el("span", {class:"badge", style:"font-size:11px"}, scanner.connection_type));
      if(scanner.wifi_signal != null) netRow.appendChild(el("span", {class:"muted", style:"font-size:11px"}, `WiFi ${scanner.wifi_signal} dBm`));
      body.appendChild(netRow);
    }

    // Area + Lost toggle
    const areaSection = el("div", {});
    areaSection.appendChild(el("div", {style:"font-weight:600;margin-bottom:6px"}, "Area assignment"));
    const areaRow = el("div", {style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"});
    areaRow.appendChild(
      scanner.area_name
        ? el("span", {class:"badge"}, scanner.area_name)
        : el("span", {class:"muted"}, "Not assigned to an area")
    );
    // Lost toggle button
    const lostBtn = el("button", {class:"btn tiny"+(scanner.lost?" primary":""),
      style: scanner.lost ? "border-color:#f59e0b;color:#f59e0b" : "border-color:#7d5c2b"
    }, scanner.lost ? "Restore Radio" : "Mark as Lost");
    lostBtn.addEventListener("click", async ()=>{
      lostBtn.disabled = true;
      try {
        await this._callWS({ type:"padspan_ha/radio_lost_set", source: scanner.source||"", lost: !scanner.lost });
        this._closeModal();
        this._toast(scanner.lost ? "Radio restored." : "Radio marked as Lost.");
        await this._getLiveSnapshot();
        this._scheduleRender();
      } catch(e) {
        lostBtn.disabled = false;
        this._toast("Failed to update lost status.", true);
      }
    });
    areaRow.appendChild(lostBtn);
    // Disabled toggle button
    const disabledBtn = el("button", {class:"btn tiny"+(scanner.disabled?" primary":""),
      style: scanner.disabled ? "border-color:#c084fc;color:#c084fc" : "border-color:#5b3b7a"
    }, scanner.disabled ? "Re-enable Radio" : "Mark as Disabled");
    disabledBtn.addEventListener("click", async ()=>{
      disabledBtn.disabled = true;
      try {
        await this._callWS({ type:"padspan_ha/radio_disabled_set", source: scanner.source||"", disabled: !scanner.disabled });
        this._closeModal();
        this._toast(scanner.disabled ? "Radio re-enabled." : "Radio marked as Disabled.");
        await this._getLiveSnapshot();
        this._scheduleRender();
      } catch(e) {
        disabledBtn.disabled = false;
        this._toast("Failed to update disabled status.", true);
      }
    });
    areaRow.appendChild(disabledBtn);
    areaSection.appendChild(areaRow);
    if(scanner.lost && scanner.lost_since){
      areaSection.appendChild(el("div", {class:"muted", style:"font-size:11px;margin-top:4px"},
        `Marked lost: ${new Date(scanner.lost_since).toLocaleString()}`));
    }
    if(scanner.disabled && scanner.disabled_since){
      areaSection.appendChild(el("div", {class:"muted", style:"font-size:11px;margin-top:4px"},
        `Disabled since: ${new Date(scanner.disabled_since).toLocaleString()}`));
    }
    body.appendChild(areaSection);

    // Visible devices
    const devSection = el("div", {}, [
      el("div", {style:"font-weight:600;margin-bottom:6px"}, `Devices visible (${devices.length})`),
    ]);
    if(devices.length){
      for(const d of devices){
        const dName = d.user_label || d.name || d.address || "Unknown";
        const rssi = d.srcRssi;
        const pct = Math.max(0, Math.min(100, ((rssi ?? -100) + 100) / 60 * 100));
        const bar = el("div", {style:`width:${pct.toFixed(0)}%;height:5px;background:#52b788;border-radius:2px`});
        const barWrap = el("div", {style:"width:60px;background:#1a2e1e;border-radius:2px"}, bar);
        const ageTxt = d.srcAge != null ? (()=>{ const s=Math.round(Number(d.srcAge)); if(s<60) return s+"s"; const m=Math.floor(s/60); if(m<60) return m+"m"; return Math.floor(m/60)+"h"; })() : "";
        const dRow = el("div", {style:"display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #0d1f12"}, [
          el("div", {style:"flex:1"}, [
            el("div", {style:"font-weight:600"}, dName),
            d.address ? el("div", {class:"muted", style:"font-size:11px;font-family:monospace"}, d.address) : null,
          ].filter(Boolean)),
          barWrap,
          rssi != null ? el("span", {class:"muted", style:"font-size:11px"}, `${rssi}dBm`) : null,
          ageTxt ? el("span", {class:"muted", style:"font-size:11px"}, ageTxt) : null,
          d.identified ? el("span", {class:"badge"}, "identified") : el("span", {class:"badge warn"}, "unknown"),
          el("button", {class:"btn tiny", onclick:()=>{ this._closeModal(); this._showObjectDetail(d); }}, "Details"),
        ].filter(Boolean));
        devSection.appendChild(dRow);
      }
    } else {
      devSection.appendChild(el("div", {class:"muted", style:"font-size:12px"}, "No objects currently visible from this scanner."));
    }
    body.appendChild(devSection);

    // Source ID
    body.appendChild(el("div", {style:"margin-top:4px"}, [
      el("span", {class:"muted", style:"font-size:11px"}, "Source ID: "),
      el("span", {style:"font-family:monospace;font-size:11px;color:#94a3b8"}, scanner.source || "—"),
    ]));

    this._openModal(name, body, `Bluetooth scanner · ${scanner.area_name || "unassigned"}`);
  }

  // ── View Rendering & Re-render Guards ────────────────────────────────────────
  // This is the single render entry point. Every view change, poll update, and
  // recovery path calls this method. The fromPoll flag indicates whether the
  // render was triggered by the 5s poll loop (true) or by a user action (false).
  //
  // RE-RENDER GUARDS: Multiple flags prevent the poll from destroying interactive
  // UI state. These are critical — removing any guard causes real bugs:
  //   _dragging / _confirming  — calibration pin placement (Tune / Beacon Tune)
  //   _stackDragging / _editDragging — map alignment drag operations
  //   _ptAlign.active          — Point Align mode (side-by-side maps)
  //   _traceback.active        — traceback animation playback
  //   _factoryResetInProgress  — factory reset progress UI
  //   focused input/select     — user typing in a form field
  //   _lastUserInteraction     — any click/scroll within last 3 seconds
  //
  // The general strategy: poll renders are "nice to have" (data freshness),
  // but user interactions are sacred (never destroy mid-action).
  _renderCurrentView(fromPoll){
    if(this.state._factoryResetInProgress) return;
    if(this.state._calibTune?._dragging || this.state._calibBeacon?._dragging || this.state._calibTune?._confirming || this.state._calibBeacon?._confirming) return;
    if(this.state.maps?._stackDragging || this.state.maps?._editDragging) return;
    if(this.state._traceback?.active && this.state.view === "traceback") return;
    // Maps upload/stack/edit tabs have fragile state (file inputs, drag handles)
    if(fromPoll && this.state.view === "maps" && (this.state.mapsTab === "upload" || this.state.mapsTab === "stack" || this.state.mapsTab === "edit")) return;
    // Overview: on polls, only update object dots (cheap) — don't rebuild the
    // entire isometric SVG which causes flicker + scroll reset.  The overview
    // view registers state._isoUpdateObjects() during its initial render;
    // calling it here replaces only the object dot layer while leaving the
    // static room geometry, floor plan image, and scanner markers untouched.
    // Resetting _lastGoodRender prevents the stale-check (10s) from triggering
    // a forced full rebuild on the next poll cycle.
    if(fromPoll && this.state.view === "overview") {
      // Detect suspend state change — force full rebuild so banner appears/disappears
      const _curSusp = !!(this.state.live?.snapshot?.suspended);
      if(this._lastSuspendState !== _curSusp) {
        this._lastSuspendState = _curSusp;
        // Fall through to full rebuild below
      } else {
        // Update suspend countdown in-place (no full rebuild)
        if(_curSusp) {
          const _bEl = this.$content.querySelector("[data-suspend-countdown]");
          if(_bEl) {
            const _r = this.state.live?.snapshot?.suspend_remaining_s ?? 0;
            const _m = Math.floor(_r / 60), _s = _r % 60;
            _bEl.textContent = "Raw radio only \u00b7 " + (_r > 0 ? `${_m}:${String(_s).padStart(2,"0")} remaining` : "ending soon");
          }
        }
        if (typeof this.state._isoUpdateObjects === "function") {
          try { this.state._isoUpdateObjects(); } catch(e) {}
        }
        this._lastGoodRender = performance.now();
        return;
      }
    }
    // Preact overview: let Preact handle its own diffing — just re-call render()
    // which diffs efficiently instead of rebuilding the entire DOM.
    if(fromPoll && this.state.view === "purelive") {
      try {
        const mod = VIEWS["purelive"];
        if(mod && mod.render) mod.render(this._ctx());
      } catch(e) {}
      this._lastGoodRender = performance.now();
      return;
    }
    // Skip POLL re-renders when the user is actively interacting.
    // Only applies to fromPoll=true — explicit renders (tab clicks, actions)
    // must always go through immediately.
    if(fromPoll){
      try {
        const active = (this.shadowRoot || this).querySelector(":focus");
        if(active){
          const tag = active.tagName;
          if(tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        }
      } catch(e) { /* ignore */ }
      if(this._lastUserInteraction && (performance.now() - this._lastUserInteraction) < 3000) return;
    }
    // Verify $content is a live node in the shadow DOM (not a stale detached reference)
    if(!this.$content || !this.$content.isConnected){
      this._ensureShadowDom();
      if(!this.$content) return;
    }
    const v = this.state.view;
    const mod = VIEWS[v];

    // Preserve scroll positions for common scroll containers so periodic 5s
    // live refreshes don't reset the user's reading position.  We capture both
    // the main content scroll and inner scrollable lists (rooms, tags, etc.),
    // then restore them in a rAF after the DOM swap completes.
    // Uses index-based matching (selector + nth occurrence) which is stable
    // because the DOM structure is rebuilt identically each render cycle.
    const selectors = [".rooms",".tags",".list-scroll",".bt-adv-list",".bt-list"];
    const scrollState = [];
    let _mainScrollTop = 0;
    try { _mainScrollTop = this.$content.scrollTop || 0; } catch(e){}
    try {
      for(const sel of selectors){
        const nodes = this.$content.querySelectorAll(sel);
        nodes.forEach((n,i)=>{ scrollState.push({ sel, i, top: n.scrollTop }); });
      }
    } catch(e) { /* ignore */ }

    // ── Fragment-first rendering ──────────────────────────────────────────
    // Build new content into a DocumentFragment BEFORE clearing $content.
    // If the view's render() throws, old content stays visible (no blank screen).
    // Only after successful render do we swap: clear old, append new.
    const frag = document.createDocumentFragment();

    // BLE health banner — show once per session when Bluetooth feed is unhealthy
    if(!this.state._bleBannerDismissed){
      const snap = this.state.live?.snapshot;
      const bleDiag = snap?.ble?.diag;
      if(bleDiag && (bleDiag.ok === false || (Array.isArray(bleDiag.errors) && bleDiag.errors.length))){
        const banner = document.createElement("div");
        banner.style.cssText = "background:#1a0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:12px 16px;margin-bottom:12px;display:flex;align-items:flex-start;gap:10px";
        const msg = document.createElement("div");
        msg.style.cssText = "flex:1;font-size:12px;color:#fca5a5;line-height:1.5";
        msg.innerHTML = "<b style='font-size:13px'>Bluetooth feed unavailable</b><br>"
          + "PadSpan™ can't see BLE scanners. This usually means Home Assistant needs a <b>full restart</b> "
          + "(Settings → System → Restart) — a reload isn't enough after first install.";
        const dismissBtn = document.createElement("button");
        dismissBtn.className = "btn inline";
        dismissBtn.style.cssText = "padding:2px 8px;font-size:11px;color:#fca5a5;border-color:#7f1d1d;flex-shrink:0";
        dismissBtn.textContent = "Dismiss";
        dismissBtn.addEventListener("click", ()=>{ this.state._bleBannerDismissed = true; banner.remove(); });
        banner.appendChild(msg);
        banner.appendChild(dismissBtn);
        frag.appendChild(banner);
      }
    }

    // ── Onboarding wizard ──────────────────────────────────────────────────
    // Shows a persistent progress bar when setup is incomplete. Detects each
    // step's completion from live state. Navigates to the right view on click.
    {
      const _onboardingDone = !!(this.state.settings && this.state.settings.onboarding_completed);
      const _hasMaps = !!(this.state.maps && this.state.maps.list && this.state.maps.list.length);
      const _hasReceivers = _hasMaps && this.state.maps.list.some(m => (m.receivers || []).length > 0);
      // "Have you got rooms yet" is a question about the FABRIC. Asking it of
      // per-photo room_bounds told anyone who built their rooms without a
      // plan — or who has since deleted one — that they had not done the step
      // they had in fact finished.
      const _hasFabricRooms = !!(this.state.model && this.state.model.room_geometry_m
        && Object.keys(this.state.model.room_geometry_m).length > 0);
      const _hasRooms = _hasFabricRooms
        || (_hasMaps && this.state.maps.list.some(m => Object.keys(m.room_bounds || {}).length > 0));
      const _hasScale = !!(this.state.model && this.state.model.map_transforms && Object.values(this.state.model.map_transforms).some(t => t && t.reference_measurements && t.reference_measurements.length > 0));
      // Accept any calibration method: cal points, fitted model, or positioned scanners in fabric
      const _calPoints = (this.state.calibration && this.state.calibration.points) ? this.state.calibration.points.length : 0;
      const _hasModel = !!(this.state.calibration && this.state.calibration.model && Object.keys(this.state.calibration.model).length > 0);
      const _hasFabricScanners = !!(this.state.model && this.state.model.scanner_positions_m && Object.keys(this.state.model.scanner_positions_m).length > 0);
      const _hasCal = _calPoints >= 5 || _hasModel || _hasFabricScanners;
      const _steps = [
        { id: "upload",   label: "Upload Floor Plan",  done: _hasMaps,      view: "maps",        mapsTab: "upload", hint: "Maps \u2192 Upload a floor plan image" },
        { id: "scale",    label: "Set Scale",           done: _hasScale,     view: "maps",        mapsTab: "edit",   hint: "Maps \u2192 Edit \u2192 Measure tool" },
        { id: "rooms",    label: "Draw Rooms",          done: _hasRooms,     view: "maps",        mapsTab: "edit",   hint: "Maps \u2192 Edit \u2192 draw room boundaries" },
        { id: "scanners", label: "Place Scanners",      done: _hasReceivers, view: "calibration", calibTab: "tune",  hint: "Calibration \u2192 Tune \u2192 drag scanners" },
        { id: "calibrate",label: "Calibrate",           done: _hasCal,       view: "calibration", calibTab: "beacon", hint: "Calibration \u2192 Beacon Tune or Pin & Listen" },
      ];
      const _completedCount = _steps.filter(s => s.done).length;
      const _allDone = _completedCount === _steps.length;

      // Auto-mark completed when all steps done
      if (_allDone && !_onboardingDone && this.state.settings && this.actions?.settingsSet) {
        try { this.actions.settingsSet({ onboarding_completed: true }).catch(() => {}); } catch(e) {}
      }

      if (!_onboardingDone && !_allDone && !this.state._onboardingDismissed && this.state.view === "overview") {
        const bar = el("div",{style:"background:#0a1f14;border:1px solid #1a4228;border-radius:8px;padding:10px 14px;margin-bottom:12px"});
        // Header
        const hdr = el("div",{style:"display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"});
        hdr.appendChild(el("div",{style:"font-weight:700;font-size:13px;color:#52b788"}, `Setup Progress \u2014 ${_completedCount}/${_steps.length}`));
        const skipBtn = el("span",{style:"cursor:pointer;font-size:10px;color:#64748b;text-decoration:underline"}, "Skip setup");
        skipBtn.addEventListener("click", () => {
          this.state._onboardingDismissed = true;
          if (this.state.settings) this.state.settings.onboarding_completed = true;
          bar.remove();
          try { this.actions?.settingsSet?.({ onboarding_completed: true })?.catch?.(() => {}); } catch(e) {}
          this._scheduleRender();
        });
        hdr.appendChild(skipBtn);
        bar.appendChild(hdr);

        // Progress dots
        const dots = el("div",{style:"display:flex;gap:4px;margin-bottom:8px"});
        for (const s of _steps) {
          dots.appendChild(el("div",{style:`flex:1;height:4px;border-radius:2px;background:${s.done ? "#52b788" : "#1b3526"}`}));
        }
        bar.appendChild(dots);

        // Step list
        const list = el("div",{style:"display:flex;flex-direction:column;gap:4px"});
        for (let i = 0; i < _steps.length; i++) {
          const s = _steps[i];
          const isNext = !s.done && (i === 0 || _steps[i-1].done);
          const row = el("div",{style:`display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;font-size:12px;${isNext ? "background:#0f2a1a;cursor:pointer" : "cursor:pointer"}`});
          row.appendChild(el("span",{style:`font-size:14px`}, s.done ? "\u2705" : isNext ? "\u25b6\ufe0f" : "\u2b1c"));
          row.appendChild(el("span",{style:`color:${s.done ? "#52b788" : isNext ? "#5eead4" : "#64748b"};font-weight:${isNext ? "700" : "400"}`}, s.label));
          if (isNext) row.appendChild(el("span",{style:"font-size:10px;color:#94a3b8;margin-left:auto"}, s.hint));
          row.addEventListener("click", () => {
            // Auto-promote to Advanced if step needs calibration (not in Basic mode)
            if (s.view === "calibration" && this.state.complexity === "basic") {
              this.state.complexity = "advanced";
              try { localStorage.setItem("padspan_complexity", "advanced"); } catch(e) {}
            }
            this.state.view = s.view;
            // Route to the correct sub-tab
            if (s.mapsTab) this.state.mapsTab = s.mapsTab;
            if (s.calibTab && this.state._calib) this.state._calib.tab = s.calibTab;
            if (this.actions?.renderRooms) this.actions.renderRooms();
            else this._scheduleRender();
          });
          list.appendChild(row);
        }
        bar.appendChild(list);
        frag.appendChild(bar);
      }
    }

    if(!mod || typeof mod.render !== "function") {
      // Skeleton loading placeholder while views load
      const skel = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
      for(let i = 0; i < 3; i++){
        const card = el("div",{class:"card",style:"min-height:80px"});
        card.appendChild(el("div",{style:"height:14px;width:40%;background:rgba(255,255,255,0.06);border-radius:4px;margin-bottom:12px"}));
        card.appendChild(el("div",{style:"height:10px;width:70%;background:rgba(255,255,255,0.04);border-radius:3px;margin-bottom:8px"}));
        card.appendChild(el("div",{style:"height:10px;width:55%;background:rgba(255,255,255,0.04);border-radius:3px"}));
        skel.appendChild(card);
      }
      frag.appendChild(skel);
      // Swap only after new content is ready
      this.$content.innerHTML = "";
      this.$content.appendChild(frag);
      this._lastGoodRender = performance.now();
      this._renderFailCount = 0;
      return;
    }
    try {
      const node = mod.render(this._ctx());

      // If the view returned a cached DOM node already displayed in $content,
      // skip the destructive swap on poll renders to preserve scroll positions.
      // ONLY for views with 100% static content (ESPHome Configs YAML blocks).
      // Dynamic views (overview, follow, objects, etc.) MUST always swap so
      // updated object positions, RSSI values, and live data are displayed.
      const _staticViews = new Set(["esphome_configs"]);
      const _isStaticTab = v === "bluetooth" && this.state.btTab === "esphome_configs";
      if(fromPoll && _isStaticTab && node && node.parentNode === this.$content){
        this._lastGoodRender = performance.now();
        this._renderFailCount = 0;
        return;
      }

      frag.appendChild(node);

      // ── Swap: clear old content and append new content atomically ────────
      this.$content.innerHTML = "";
      this.$content.appendChild(frag);
      this._lastGoodRender = performance.now();
      this._renderFailCount = 0;

      // Restore scroll after DOM paint
      requestAnimationFrame(()=> {
        try {
          // Restore main content scroll
          if (_mainScrollTop > 0 && fromPoll) this.$content.scrollTop = _mainScrollTop;
          for(const s of scrollState){
            const nodes = this.$content.querySelectorAll(s.sel);
            const n = nodes && nodes[s.i];
            if(n) n.scrollTop = s.top;
          }
        } catch(e) { /* ignore */ }
      });
    } catch (e) {
      // Render failed — OLD content is still visible (not cleared).
      // Only show error UI if content is actually empty (e.g. first render).
      console.error("PadSpan render error:", e);
      this._renderFailCount = (this._renderFailCount || 0) + 1;
      if(!this.$content.children.length){
        this.$content.innerHTML = "";
        this.$content.appendChild(frag); // banners at least
        const errDiv = document.createElement("div");
        errDiv.style.cssText = "background:#1a0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:16px;margin:16px 0;color:#fca5a5";
        const h = document.createElement("div");
        h.style.cssText = "font-weight:700;font-size:15px;margin-bottom:8px";
        h.textContent = "UI render error — view: " + this.state.view;
        const sub = document.createElement("div");
        sub.style.cssText = "font-size:12px;margin-bottom:8px;color:#fca5a5";
        sub.textContent = "A JavaScript error prevented this view from rendering. Open browser console (F12) for details.";
        const pre = document.createElement("pre");
        pre.style.cssText = "font-size:11px;white-space:pre-wrap;word-break:break-all;background:#0a0000;padding:10px;border-radius:4px;overflow:auto;max-height:300px;color:#f87171";
        pre.textContent = String(e?.stack || e);
        const retryBtn = document.createElement("button");
        retryBtn.className = "btn";
        retryBtn.style.cssText = "margin-top:10px";
        retryBtn.textContent = "Retry";
        retryBtn.addEventListener("click", ()=>{ this._renderFailCount = 0; this._refreshAll(true); });
        errDiv.appendChild(h); errDiv.appendChild(sub); errDiv.appendChild(pre); errDiv.appendChild(retryBtn);
        this.$content.appendChild(errDiv);
      }
    }
  }


  // ── Toast Notifications ─────────────────────────────────────────────────────
  // Temporary message bar at the top of the content area. Auto-hides after 4.5s.
  // Used for confirmations ("Tagged: Kitchen Beacon"), errors ("WS call failed"),
  // and progress ("Refreshing..."). Only one toast visible at a time.
  _toast(msg, isErr=false){
    const t = this.$("#toast");
    if(!t) return;
    t.textContent = msg;
    t.classList.toggle("error", !!isErr);
    t.classList.remove("hidden");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(()=>t.classList.add("hidden"), 4500);
  }
}

// ── Register Custom Element ──────────────────────────────────────────────────
// HA discovers this via the panel config in __init__.py. Once defined,
// HA creates an instance and drives it through connectedCallback + set hass().
//
// Guard against a duplicate definition: on an integration reload/update the
// panel re-registers with a fresh BUILD_ID module_url, so a browser that still
// has the previous module imported will load BOTH copies. An unguarded define()
// throws "name 'padspan-ha-app' has already been used", which aborts panel
// init mid-way and leaves the UI half-rendered (dead buttons, broken search,
// watchdog "no successful render" loop). Defining once and no-opping the
// duplicate keeps the panel functional until the next full refresh.
if (!customElements.get("padspan-ha-app")) {
  customElements.define("padspan-ha-app", PadSpanHaApp);
}
