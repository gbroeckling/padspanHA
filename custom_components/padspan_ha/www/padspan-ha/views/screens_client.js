// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// This page as an open screen (screens.py): while
// settings.screens_remote_enabled is on, the panel and the Atlas page join
// padspan_ha/screens_join and do what Home Assistant sends:
//   reload    load the page again (new code after an update)
//   announce  the message big over the page, with a chime, read aloud if asked
//   rename    keep the new name (this browser's storage)
// Off: nothing joins, nothing is shown. The screen's id and name live in this
// browser's localStorage, so a wall keeps its name across reloads.

const ID_KEY = "padspan_screen_id", NAME_KEY = "padspan_screen_name";

function _store(key, value){
  try {
    if (value === undefined) return localStorage.getItem(key) || "";
    if (value) localStorage.setItem(key, value); else localStorage.removeItem(key);
  } catch (_) { /* storage blocked: a new id each load */ }
  return value || "";
}

export function screenId(){
  let id = _store(ID_KEY);
  if (!/^[a-z0-9]{4,40}$/.test(id)) {
    id = Array.from({ length: 12 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
    _store(ID_KEY, id);
  }
  return id;
}

/** What kind of device this is, from its user agent: "Fully Kiosk · Android", "Chrome · Windows". */
export function deviceWord(ua = (globalThis.navigator && navigator.userAgent) || ""){
  const os = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
  const app = /Fully/i.test(ua) ? "Fully Kiosk" : /Home ?Assistant/i.test(ua) ? "HA app" : /Edg\//.test(ua) ? "Edge"
    : /Firefox\//.test(ua) ? "Firefox" : /Silk\//.test(ua) ? "Silk" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return os ? `${app} · ${os}` : app;
}

let _overlay = null, _overlayTimer = null;

function _chime(){
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    const ac = new AC(), t0 = ac.currentTime;
    for (const [f, at] of [[880, 0], [660, 0.28]]) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.6);
      o.connect(g); g.connect(ac.destination);
      o.start(t0 + at); o.stop(t0 + at + 0.65);
    }
    setTimeout(() => { try { ac.close(); } catch (_) {} }, 1500);
  } catch (_) { /* a browser that won't play before a first tap */ }
}

function _speak(text){
  try {
    const ss = globalThis.speechSynthesis;
    if (!ss || !globalThis.SpeechSynthesisUtterance) return;
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = document.documentElement.lang || navigator.language || "en";
    ss.speak(u);
  } catch (_) { /* no voice on this device */ }
}

export function closeAnnouncement(){
  clearTimeout(_overlayTimer); _overlayTimer = null;
  if (_overlay) { _overlay.remove(); _overlay = null; }
}

/** The message over the whole page. Text only (textContent): an automation's
 *  words are never read as HTML. A tap closes it; a new one replaces it. */
export function showAnnouncement(a, doc = document){
  closeAnnouncement();
  const msg = String((a && a.message) || "").slice(0, 300);
  if (!msg) return null;
  const wrap = doc.createElement("div");
  wrap.setAttribute("role", "alertdialog");
  wrap.setAttribute("aria-live", "assertive");
  wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(4,10,5,0.78);cursor:pointer;padding:4vmin;box-sizing:border-box";
  const card = doc.createElement("div");
  card.style.cssText = "background:#0f1a12;border:2px solid #52b788;border-radius:18px;padding:4vmin 5vmin;max-width:88vw;" +
    "box-shadow:0 10px 40px rgba(0,0,0,0.5);text-align:center;font-family:Inter,system-ui,sans-serif";
  if (a.title) {
    const ti = doc.createElement("div");
    ti.textContent = String(a.title).slice(0, 60);
    ti.style.cssText = "color:#52b788;font-weight:700;font-size:min(4vmin,34px);margin-bottom:1.5vmin;letter-spacing:0.02em";
    card.appendChild(ti);
  }
  const tx = doc.createElement("div");
  tx.textContent = msg;
  tx.style.cssText = "color:#e2e8f0;font-weight:700;font-size:min(7vmin,64px);line-height:1.25;overflow-wrap:anywhere";
  card.appendChild(tx);
  const hint = doc.createElement("div");
  hint.textContent = "Tap to close";
  hint.style.cssText = "color:#64748b;font-size:min(2.4vmin,16px);margin-top:2.5vmin";
  card.appendChild(hint);
  wrap.appendChild(card);
  wrap.addEventListener("click", closeAnnouncement);
  doc.body.appendChild(wrap);
  _overlay = wrap;
  const secs = Math.min(300, Math.max(3, Number(a.seconds) || 15));
  _overlayTimer = setTimeout(closeAnnouncement, secs * 1000);
  if (a.chime !== false) _chime();
  if (a.speak) setTimeout(() => _speak(msg), a.chime !== false ? 900 : 0);
  return wrap;
}

/** One page as a screen. `page` "panel" or "atlas"; `info()` its build,
 *  kiosk and view at join time; `keepSubscribed` push_subscription.js's.
 *  sync(conn, on) joins or leaves; view(v) says what it shows now. */
export function createScreen(page, info, keepSubscribed, hooks = {}){
  let conn = null, stop = null, lastView = "", joinMsg = null;
  const onPush = (m) => {
    if (!m || typeof m !== "object") return;
    if (m.cmd === "reload") {
      if (hooks.beforeReload && hooks.beforeReload() === false) return;
      location.reload();
    } else if (m.cmd === "announce") {
      showAnnouncement(m);
      if (hooks.onAnnounce) hooks.onAnnounce(m);
    } else if (m.cmd === "rename") {
      _store(NAME_KEY, String(m.name || "").trim().slice(0, 60));
      if (joinMsg) joinMsg.name = _store(NAME_KEY);
    }
  };
  const leave = () => { if (stop) { stop(); stop = null; } conn = null; };
  return {
    sync(c, on){
      if (!on || !c) { leave(); return; }
      if (c === conn && stop) return;
      leave();
      conn = c;
      const i = info() || {};
      lastView = String(i.view || "").slice(0, 40);
      // The same object is sent again on each reconnect: view() keeps it current.
      joinMsg = {
        type: "padspan_ha/screens_join", screen_id: screenId(), name: _store(NAME_KEY).slice(0, 60),
        page, view: lastView, kiosk: !!i.kiosk, build: String(i.build || "").slice(0, 20), device: deviceWord().slice(0, 120),
      };
      stop = keepSubscribed(c, joinMsg, onPush);
    },
    view(v){
      v = String(v || "").slice(0, 40);
      if (!conn || !stop || v === lastView) return;
      lastView = v;
      if (joinMsg) joinMsg.view = v;
      try { conn.sendMessagePromise({ type: "padspan_ha/screens_update", screen_id: screenId(), view: v }).catch(() => {}); } catch (_) {}
    },
    leave,
  };
}
