// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// What a screen running PadSpan can do, for the opt-in usage report.
//
// Garry, 2026-10-05: whether a low-memory machine has to give up the Atlas or
// the 3D house "must be clear before anyone pays for pro", and the minimum
// requirements need the screen's half too — the Home Assistant machine's
// numbers (perf_sampler.py) cannot say whether the tablet on the wall keeps
// up. So, while a panel is on screen and the report is on:
//
//   once a minute   client_fps:<view>:<bucket>   frames per second over 3 s
//                   client_heap:<view>:<bucket>  JavaScript heap (Chromium only)
//   once per load   client_dev:<word>            the browser's own coarse memory
//                                                figure, CPU threads, WebGL 2,
//                                                touch
//
// <view> is "sim" when the 3D house is drawing (a three.js canvas covering a
// good part of the screen), else what the caller says ("atlas" or "other").
// The fps event is also the panel's heartbeat: the backend counts Home
// Assistant's load by the view on screen from it (perf_sampler.note_view).
// Buckets from fixed lists only — telemetry.CLIENT_* holds the same lists
// (tests/test_telemetry.py keeps them equal). Nothing is measured while the
// report is off, the page is hidden or the panel is not in the document.

export const CLIENT_VIEWS = ["atlas", "sim", "other"];
export const CLIENT_FPS = ["lt10", "10_24", "24_45", "45up"];
export const CLIENT_HEAP = ["lt128m", "128_256m", "256_512m", "512m_1g", "1g_up"];
export const CLIENT_DEV = ["mem_lt1g", "mem_1g", "mem_2g", "mem_4g", "mem_8g_up", "mem_unknown",
                           "cores_1_2", "cores_3_4", "cores_5_8", "cores_9_up", "cores_unknown",
                           "webgl2_yes", "webgl2_no", "touch_yes", "touch_no", "lastrep_yes", "lastrep_no"];
// The screen it runs on, in buckets (2026-10-21, for 4K walls): its resolution
// in device pixels by the long side, orientation, pixel density, what kind of
// screen (by its pointer and size) and whether the computer has more than one
// monitor. Never the screen's exact size. client_screen_seen is counted once
// per screen per report window by Home Assistant (a random id kept in this
// browser, ws_telemetry.py), so the report can say how many screens a house runs.
export const CLIENT_SCREEN = ["res_lt720", "res_720", "res_1080", "res_1440", "res_4k", "res_5k_up",
                              "orient_land", "orient_port", "dpr_1", "dpr_1_5", "dpr_2", "dpr_3_up",
                              "kind_phone", "kind_tablet", "kind_desktop", "kind_large",
                              "screens_1", "screens_2up", "screens_unknown"];

const PERIOD_MS = 60000;
const MEASURE_MS = 3000;
const FIRST_MS = 20000;          // after the panel settles, not during its first render
const SIM_SHARE = 0.15;          // a three.js canvas this much of the window is the 3D house

export function fpsBucket(fps){
  return fps < 10 ? "lt10" : fps < 24 ? "10_24" : fps < 45 ? "24_45" : "45up";
}

export function heapBucket(bytes){
  const mb = bytes / 1048576;
  return mb < 128 ? "lt128m" : mb < 256 ? "128_256m" : mb < 512 ? "256_512m" : mb < 1024 ? "512m_1g" : "1g_up";
}

export function deviceWords(nav, hasWebGL2){
  const out = [];
  const m = Number(nav && nav.deviceMemory);
  out.push(!(m > 0) ? "mem_unknown" : m < 1 ? "mem_lt1g" : m < 2 ? "mem_1g" : m < 4 ? "mem_2g"
    : m < 8 ? "mem_4g" : "mem_8g_up");
  const c = Number(nav && nav.hardwareConcurrency);
  out.push(!(c > 0) ? "cores_unknown" : c <= 2 ? "cores_1_2" : c <= 4 ? "cores_3_4" : c <= 8 ? "cores_5_8"
    : "cores_9_up");
  out.push(hasWebGL2 ? "webgl2_yes" : "webgl2_no");
  out.push(Number(nav && nav.maxTouchPoints) > 0 ? "touch_yes" : "touch_no");
  return out;
}

/** The screen's words (CLIENT_SCREEN) for one window. */
export function screenWords(win){
  const out = [];
  const sc = (win && win.screen) || {}, dpr = Number(win && win.devicePixelRatio) || 1;
  const sw = Number(sc.width) || Number(win && win.innerWidth) || 0, sh = Number(sc.height) || Number(win && win.innerHeight) || 0;
  const L = Math.max(sw, sh) * dpr;
  out.push(L < 1280 ? "res_lt720" : L < 1920 ? "res_720" : L < 2560 ? "res_1080" : L < 3840 ? "res_1440" : L < 5120 ? "res_4k" : "res_5k_up");
  out.push(sw >= sh ? "orient_land" : "orient_port");
  out.push(dpr < 1.25 ? "dpr_1" : dpr < 1.75 ? "dpr_1_5" : dpr < 2.5 ? "dpr_2" : "dpr_3_up");
  const mq = (q) => { try { return !!(win.matchMedia && win.matchMedia(q).matches); } catch (_) { return false; } };
  const fine = mq("(pointer: fine)"), coarse = mq("(pointer: coarse)");
  const short = Math.min(sw, sh), long = Math.max(sw, sh);
  out.push(fine ? "kind_desktop" : coarse ? (short < 600 ? "kind_phone" : long >= 1600 && !(Number(win.navigator && win.navigator.maxTouchPoints) > 0) ? "kind_large" : "kind_tablet")
    : "kind_large");                                    // no pointer at all: a TV or a wall
  out.push(sc.isExtended === true ? "screens_2up" : sc.isExtended === false ? "screens_1" : "screens_unknown");
  return out;
}

/** A random id for this browser's screen, kept in localStorage; it goes only
 *  to Home Assistant, which counts it and never stores or reports it. */
export function screenId(store){
  try {
    let id = store.getItem("padspan_screen_id");
    if (!/^[0-9a-f]{16}$/.test(id || "")) {
      id = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      store.setItem("padspan_screen_id", id);
    }
    return id;
  } catch (_) { return null; }
}

// Whether this panel's sensor states carry last_reported (a steady room's
// temperature stays fresh by it: lights_map.js gatherLights), or null with
// no sensor to tell by.
export function lastReportedWord(states){
  if (!states || typeof states !== "object") return null;
  for (const [eid, st] of Object.entries(states)) {
    if (eid.startsWith("sensor.") && st && typeof st === "object") return st.last_reported ? "lastrep_yes" : "lastrep_no";
  }
  return null;
}

// The 3D house on screen: a visible three.js canvas (three.js marks its own
// with data-engine) covering SIM_SHARE of the window, anywhere under `root`,
// shadow roots included.
export function simOnScreen(root, win){
  const area = Math.max(1, (win.innerWidth || 0) * (win.innerHeight || 0));
  const roots = [root];
  for (let i = 0; i < roots.length && i < 400; i++){
    const r = roots[i];
    if (!r || typeof r.querySelectorAll !== "function") continue;
    for (const c of r.querySelectorAll("canvas[data-engine]")){
      if (!String(c.getAttribute("data-engine") || "").startsWith("three.js")) continue;
      if (c.isConnected && c.clientWidth * c.clientHeight >= SIM_SHARE * area) return true;
    }
    for (const el of r.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
  }
  return false;
}

function frameRate(ms){
  return new Promise((resolve) => {
    let frames = 0;
    let done = false;
    const t0 = performance.now();
    const finish = () => {
      if (done) return;
      done = true;
      resolve(frames * 1000 / Math.max(1, performance.now() - t0));
    };
    const step = (t) => {
      if (done) return;
      frames += 1;
      if (t - t0 >= ms) finish(); else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(finish, ms + 1000);   // a page hidden mid-way: no frames, and dropped below
  });
}

// Start the probe for one panel. `viewClass()` says "atlas" or "other" for
// what the caller is showing; `enabled()` is the report switch; `send(name)`
// passes one event to the report. Returns { stop }.
export function startClientPerf({ root, viewClass, enabled, send, states }){
  let stopped = false;
  let busy = false;
  let devSent = false;
  let timer = null;
  const visible = () => document.visibilityState === "visible" && (!root.host || root.host.isConnected);

  const tick = async () => {
    if (stopped || busy || !enabled() || !visible()) return;
    busy = true;
    try {
      if (!devSent){
        devSent = true;
        for (const w of deviceWords(navigator, typeof WebGL2RenderingContext !== "undefined")) send("client_dev:" + w);
        const lr = lastReportedWord(states ? states() : null);
        if (lr) send("client_dev:" + lr);
        for (const w of screenWords(window)) send("client_screen:" + w);
      }
      // Every tick: Home Assistant forgets the ids with each report, so a
      // wall that runs for weeks is still counted in each one (it counts an
      // id once per report, the repeats cost nothing).
      const sid = screenId(window.localStorage);
      if (sid) send("client_screen_seen", { screen: sid });
      const fps = await frameRate(MEASURE_MS);
      if (stopped || !enabled() || !visible()) return;
      let view = simOnScreen(root, window) ? "sim" : viewClass();
      if (!CLIENT_VIEWS.includes(view)) view = "other";
      send(`client_fps:${view}:${fpsBucket(fps)}`);
      const heap = performance && performance.memory && performance.memory.usedJSHeapSize;
      if (heap > 0) send(`client_heap:${view}:${heapBucket(heap)}`);
    } catch (_e) {
      // the probe must never be the error
    } finally {
      busy = false;
    }
  };

  const first = setTimeout(() => { tick(); timer = setInterval(tick, PERIOD_MS); }, FIRST_MS);
  return {
    stop(){
      stopped = true;
      clearTimeout(first);
      if (timer) clearInterval(timer);
    },
  };
}
