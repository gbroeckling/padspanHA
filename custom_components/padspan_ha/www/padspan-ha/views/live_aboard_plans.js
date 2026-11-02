// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Add data via plans (experimental, off by default; 2026-11): Live Aboard's
// Plans tool, Edit → Plans, beside Door, Window, Heights and Strip. Present
// only while Settings → AI's master switch is on and an AI Task is chosen
// (live_aboard_edit.js setPlans). Stage 1a, the dry run: the list view only.
//
//   The sheet   which placed plans to read (grouped by floor, all ticked),
//               which kinds (stairs; railings beside them; lights come
//               later), what to expect, where the plans go (a local AI keeps
//               them in the house; a cloud one needs a tick), and one button.
//   The job     runs on the server (ws_plan_ai.py); the sheet asks for its
//               status every 3 s and can cancel it between reads.
//   The list    one row per suggestion, with a crop of the plan drawn from
//               the Library's signed picture link and the box the AI gave:
//               mark it wrong (one reason chip, written at once), later, or
//               take that back; "already in your house" and "ignored before"
//               listed apart; Manage ignored. New and Correction are shown
//               but come in the next beta: nothing here writes the house.
//
// Imports nothing; the editor hands in the sheet, the host's callWS and the
// floors. No placement, picture size or map record is read here: the server
// answers in metres and the crop is cut by fractions of the picture.

const CSS = `
.la3d-sheet.plans{max-height:calc(100% - 120px);overflow-y:auto;width:min(520px,calc(100% - 24px))}
@media (max-width:600px){.la3d-sheet.plans{left:10px;right:10px;width:auto;top:auto!important;bottom:58px;max-height:60%}}
.la3d-sheet.plans h4 .pl-chip{flex:none}
.la3d-sheet.plans .pl-ban{font-size:11px;line-height:1.45;color:#fde68a;border:1px solid rgba(251,191,36,.45);border-radius:8px;padding:6px 8px;margin:0 0 8px}
.la3d-sheet.plans .pl-chip{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.06em;color:#fbbf24;border:1px solid rgba(251,191,36,.45);border-radius:999px;padding:0 7px;margin-left:6px;vertical-align:middle}
.la3d-sheet.plans .pl-sum{font-size:12px;color:#cbd5e1;line-height:1.5;margin:0 0 8px}
.la3d-sheet.plans h5{font-size:12px;color:#a7f3d0;margin:10px 0 4px}
.la3d-sheet.plans .pl-row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid rgba(255,255,255,.08)}
.la3d-sheet.plans .pl-row canvas{flex:none;width:120px;height:84px;border-radius:6px;background:#0b1510;border:1px solid rgba(255,255,255,.1)}
.la3d-sheet.plans .pl-txt{flex:1;min-width:0;font-size:12px;line-height:1.45;color:#e2e8f0}
.la3d-sheet.plans .pl-sub{font-size:11px;color:#94a3b8}
.la3d-sheet.plans .pl-rel{display:inline-block;font-size:10px;font-weight:700;border-radius:999px;padding:0 7px;margin-right:6px;border:1px solid}
.la3d-sheet.plans .pl-rel.new{color:#f59e0b;border-color:rgba(245,158,11,.5)}
.la3d-sheet.plans .pl-rel.correction{color:#60a5fa;border-color:rgba(96,165,250,.5)}
.la3d-sheet.plans .pl-rel.stacked{color:#c4b5fd;border-color:rgba(196,181,253,.5)}
.la3d-sheet.plans .pl-rel.stale{color:#94a3b8;border-color:rgba(148,163,184,.5)}
.la3d-sheet.plans .pl-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.la3d-sheet.plans .pl-acts button{font:inherit;font-size:11px;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e2e8f0;cursor:pointer;min-height:32px}
.la3d-sheet.plans .pl-acts button[disabled]{opacity:.45;cursor:default}
.la3d-sheet.plans .pl-acts button.go{background:#1b4332;border-color:#52b788;color:#d8f3dc;font-weight:700}
.la3d-sheet.plans .pl-acts button.why{border-color:rgba(245,158,11,.5);color:#fde68a}
.la3d-sheet.plans label.pl-tick{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#e2e8f0;padding:4px 0;cursor:pointer}
.la3d-sheet.plans label.pl-tick input{margin-top:2px}
.la3d-sheet.plans label.pl-tick img{flex:none;width:44px;height:32px;object-fit:cover;border-radius:4px;background:#0b1510;border:1px solid rgba(255,255,255,.1)}
.la3d-sheet.plans .pl-note{font-size:11px;color:#94a3b8;line-height:1.45;margin:6px 0}
.la3d-sheet.plans .pl-bad{color:#fca5a5}
.la3d-sheet.plans .pl-foot{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}
.la3d-sheet.plans .pl-foot button{font:inherit;font-size:11px;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e2e8f0;cursor:pointer;min-height:32px}
`;
const BANNER = "Experimental. On a small local AI about 2 in 10 stair suggestions are wrong and 2-3 in 10 real stairs are missed; railings about half; "
  + "lights only where the plan draws them. Doors and windows aren't offered: the local model got them mostly wrong.";
const CUE = { stairs: "Check which way is up and the shape.", railing: "The AI can't tell the side for sure: look at the plan." };
const WHY = [["wrong_place", "Wrong place"], ["nothing_there", "Nothing there"], ["already_here", "Already here"], ["wrong_kind", "Wrong kind"], ["cant_tell", "Can't tell"]];
const WHY_WORD = Object.fromEntries(WHY);
const NEXT_BETA = "Comes in the next beta: this version writes nothing to your house.";
const POLL_MS = 3000;
const CANCEL_WORDS = { user: "cancelled", switch_off: "stopped: the switch was turned off", house3d_off: "stopped: Live Aboard was turned off",
  licence: "stopped: the licence lapsed", plan_gone: "stopped: a plan was removed", plan_changed: "stopped: a plan was moved or replaced", restart: "" };

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const m1 = (v) => (num(v) === null ? "?" : (Math.round(v * 10) / 10).toFixed(1));
const mins = (s) => { s = Math.max(0, Math.round(num(s) || 0)); return s >= 60 ? `${Math.floor(s / 60)} m ${s % 60} s` : `${s} s`; };

/** Where the plans go, in the photo step's own words (its aiNote) with "plan" for "photo".
 *  The backup is named only as what it is: it reads only with its own tick (backupOk). */
function planNote(ai, n, backupOk){
  const name = (ai && ai.name) || "The AI Task";
  const them = n === 1 ? "the plan" : "the plans";
  const whereOf = (local, it = "it") => (local === true ? `${it[0].toUpperCase()}${it.slice(1)} runs in your home, so ${them} stay in the house.`
    : local === false ? `${it[0].toUpperCase()}${it.slice(1)} runs in the cloud: ${them} leave the house for that service.`
    : `If ${it} runs in the cloud, ${them} leave the house for that service.`);
  const bk = ai && ai.backup ? (ai.backup_name || ai.backup) : null;
  if (bk && ai.main_away) return backupOk ? `The main AI Task is away, so the backup, ${bk}, will read ${them}. ${whereOf(ai.backup_local)} PadSpan keeps no copy.`
    : `The main AI Task is away. The backup, ${bk}, can read ${them} if you tick it below. ${whereOf(ai.backup_local, "that one")}`;
  const also = bk && backupOk ? ` If it's away, the backup, ${bk}, reads them instead. ${whereOf(ai.backup_local, "that one")}` : "";
  return `${name} will read ${them}. ${whereOf(ai && ai.local)}${also} PadSpan keeps no copy.`;
}
/** Whether a plan could leave the house: the main AI Task, or a backup allowed to read it, not local. */
const mayLeave = (ai, backupOk) => !!ai && (ai.local !== true || (!!backupOk && !!ai.backup && ai.backup_local !== true));

/**
 * ctx = { root, sheet, guard, host() → {callWS, settings} | null, floors() → [{fl: {id, name, outdoor}}],
 *         hint(text, bad), redraw() (the editor's paint and sheet again) }
 */
export function createPlans(ctx){
  const { sheet, guard } = ctx;
  let shownNow = false, step = "idle", info = null, sess = null, poll = null, busy = false, err = "", view = "list";
  let urls = null, ignored = null, failing = null, cancelNote = "", runningId = null;
  const picked = new Set();
  const kinds = { stairs: true, railing: true };
  let cloudOk = false, backupOk = false;
  const style = document.createElement("style");
  style.textContent = CSS;
  ctx.root.appendChild(style);

  const redraw = () => { const y = sheet.scrollTop; ctx.redraw(); sheet.scrollTop = y; };   // a verdict never jumps the list to its top
  const d = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const btn = (text, title, act, cls) => {
    const b = d("button", cls, text);
    b.type = "button"; b.title = title || "";
    b.addEventListener("click", guard((e) => { e.stopPropagation(); act(); }));
    return b;
  };
  const call = (type, extra) => {
    const h = ctx.host();
    if (!h || typeof h.callWS !== "function") return Promise.reject(new Error("The Plans tool has no connection."));
    return h.callWS({ type: `padspan_ha/${type}`, ...(extra || {}) });
  };
  const fail = (e) => { err = String((e && (e.message || e.code)) || e || "failed"); busy = false; redraw(); };
  const floorName = (fid) => { const G = (ctx.floors() || []).find(g => g && g.fl && String(g.fl.id) === String(fid)); return G ? (G.fl.name || String(fid)) : String(fid); };
  const outdoor = (fid) => { const G = (ctx.floors() || []).find(g => g && g.fl && String(g.fl.id) === String(fid)); return !!(G && G.fl.outdoor); };
  const planName = (mid) => { const p = ((info && info.plans) || []).find(x => x.map_id === mid) || ((sess && sess.plans) || []).find(x => x.map_id === mid); return p ? (p.name || "a plan") : "a plan"; };
  const sugs = () => Object.values((sess && sess.suggestions) || {});
  const movedPlan = (mid) => !!((sess && sess.plans) || []).find(x => x.map_id === mid && x.changed);

  // ── opening: what is there to read, and what the last session left ───────
  async function open(){
    busy = true; err = ""; step = "loading"; redraw();
    try {
      info = await call("plan_ai_plans");
      if (!info || !Array.isArray(info.plans)) { info = null; step = "sample"; busy = false; redraw(); return; }
      picked.clear();
      for (const p of info.plans) if (!outdoor(p.floor_id)) picked.add(p.map_id);
      loadUrls();
      if (info.running) { sess = null; step = "progress"; startPoll(info.running); }
      else if (info.latest) {
        const r = await call("plan_ai_status", { session: info.latest });
        sess = r && r.session ? r.session : null;
        // What the last session left, or how it ended ("Home Assistant restarted during the read; run it again").
        step = sess && (Object.keys(sess.suggestions || {}).length || sess.status !== "done") ? "list" : "consent";
      } else step = "consent";
    } catch (e) { step = "consent"; err = String((e && e.message) || e); }
    busy = false;
    redraw();
  }
  function loadUrls(){
    if (urls) return;
    call("maps_image_urls").then((r) => { urls = (r && r.image_urls) || {}; redraw(); }).catch(() => { urls = {}; });
  }

  /** Back to the plans and the button, with what the server says now (a start may be allowed again). */
  async function readAgain(){
    step = "consent"; err = ""; redraw();
    try { const r = await call("plan_ai_plans"); if (r && Array.isArray(r.plans)) info = r; } catch (e) { err = String((e && e.message) || e); }
    redraw();
  }

  // ── the job: start, poll, cancel ──────────────────────────────────────────
  async function start(){
    if (busy) return;
    const ids = [...picked];
    if (!ids.length) { err = "Tick at least one plan."; redraw(); return; }
    if (mayLeave(info && info.ai, backupOk) && !cloudOk) { err = "Tick that you understand the plans leave the house, or choose a local AI Task in Settings → AI."; redraw(); return; }
    busy = true; err = ""; redraw();
    try {
      const want = ["stairs"].concat(kinds.railing ? ["railing"] : []);
      const r = await call("plan_ai_start", { map_ids: ids, kinds: want, backup_ok: !!backupOk, cloud_ok: !!cloudOk });
      sess = null; cancelNote = ""; step = "progress"; busy = false;
      startPoll(r.session);
    } catch (e) { fail(e); }
    redraw();
  }
  function startPoll(sid){
    stopPoll();
    runningId = sid;
    const tick = guard(async () => {
      try {
        const r = await call("plan_ai_status", { session: sid });
        sess = r && r.session ? r.session : sess;
        if (sess && sess.status !== "running") { stopPoll(); step = "list"; loadUrls(); }
      } catch (e) { err = String((e && e.message) || e); stopPoll(); step = "consent"; }
      redraw();
    });
    poll = setInterval(tick, POLL_MS);
    tick();
  }
  function stopPoll(){ if (poll) { clearInterval(poll); poll = null; } }
  async function cancel(){
    if (!runningId) return;
    try { const r = await call("plan_ai_cancel", { session: runningId }); cancelNote = (r && r.message) || ""; }
    catch (e) { cancelNote = String((e && e.message) || e); }
    redraw();
  }

  // ── verdicts: failure, later, take that back; written at once ────────────
  async function verdict(sug, v, why){
    if (busy || !sess) return;
    busy = true; err = ""; redraw();
    try {
      const r = await call("plan_ai_verdict", { session: sess.id, rev: sess.rev, sug_id: sug.id, v, ...(why ? { why } : {}) });
      sess.rev = r.rev; sess.suggestions[sug.id] = r.suggestion; failing = null;
      ctx.hint(v === "failure" ? "Noted." : v === "later" ? "Later, then." : "Taken back.");
    } catch (e) {
      if (e && e.code === "rev_mismatch") { ctx.hint("That list had changed: here it is again."); try { const r = await call("plan_ai_status", { session: sess.id }); sess = r.session || sess; } catch (_) { /* kept */ } }
      else err = String((e && e.message) || e);
    }
    busy = false;
    redraw();
  }
  async function forget(key){
    if (busy) return;
    busy = true; err = ""; redraw();
    try {
      await call("plan_ai_reject_forget", { key });
      ignored = null;
      if (sess) { const r = await call("plan_ai_status", { session: sess.id }); sess = r.session || sess; }
    } catch (e) { err = String((e && e.message) || e); }
    busy = false;
    redraw();
  }
  async function openIgnored(){
    view = "ignored"; ignored = null; redraw();
    try { const r = await call("plan_ai_rejects_get"); ignored = (r && r.rejects) || []; } catch (e) { err = String((e && e.message) || e); ignored = []; }
    redraw();
  }

  // ── the crop: the plan's picture round the AI's box ───────────────────────
  const pics = new Map();
  function drawCrop(c, sug){
    const url = urls && urls[sug.map_id];
    if (movedPlan(sug.map_id)) return;                    // the picture may not be the one that was read
    if (!url || !Array.isArray(sug.box_px) || !Array.isArray(sug.frame)) return;
    let img = pics.get(url);
    if (!img) { img = new Image(); img.src = url; pics.set(url, img); }
    const paint = () => {
      try {
        const [fw, fh] = sug.frame, [x1, y1, x2, y2] = sug.box_px;
        const W = img.naturalWidth, H = img.naturalHeight;
        if (!W || !H) return;
        const bx = x1 / fw * W, by = y1 / fh * H, bw = (x2 - x1) / fw * W, bh = (y2 - y1) / fh * H;
        const m = Math.max(bw, bh) * 0.6;
        let sx = bx - m, sy = by - m, sw = bw + 2 * m, sh = bh + 2 * m;
        const ar = c.width / c.height;
        if (sw / sh < ar) { const nw = sh * ar; sx -= (nw - sw) / 2; sw = nw; } else { const nh = sw / ar; sy -= (nh - sh) / 2; sh = nh; }
        const g = c.getContext("2d");
        g.fillStyle = "#0b1510"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        const k = c.width / sw;
        g.strokeStyle = "#f59e0b"; g.lineWidth = 2; g.setLineDash([5, 3]);
        g.strokeRect((bx - sx) * k, (by - sy) * k, bw * k, bh * k);
      } catch (_) { /* a picture that will not draw leaves the box blank */ }
    };
    if (img.complete && img.naturalWidth) paint(); else img.addEventListener("load", paint, { once: true });
  }

  // ── the sheet ─────────────────────────────────────────────────────────────
  function head(title, sub){
    const h = d("h4");
    h.appendChild(d("span", null, title));
    h.appendChild(d("span", "pl-chip", "EXPERIMENTAL"));
    sheet.appendChild(h);
    if (sub) sheet.appendChild(d("p", "la3d-sub", sub));
  }
  function errLine(){ if (err) sheet.appendChild(d("div", "pl-note pl-bad", err)); }

  function paintConsent(){
    head("Add data via plans", "Your AI reads the floor plans you placed; you check every item.");
    sheet.appendChild(d("div", "pl-ban", BANNER));
    errLine();
    const plans = (info && info.plans) || [];
    if (!plans.length) { sheet.appendChild(d("div", "pl-note", "No placed floor plans to read: add one in Mapping and place it in Mapping → 3D Stack first.")); return; }
    // 1. Which plans, by floor; two on one floor said so.
    const byFloor = new Map();
    for (const p of plans) { if (outdoor(p.floor_id)) continue; if (!byFloor.has(p.floor_id)) byFloor.set(p.floor_id, []); byFloor.get(p.floor_id).push(p); }
    sheet.appendChild(d("h5", null, "Which plans"));
    for (const [fid, list] of byFloor) {
      sheet.appendChild(d("div", "pl-sub", floorName(fid)));
      for (const p of list) {
        const l = d("label", "pl-tick");
        const cb = d("input"); cb.type = "checkbox"; cb.checked = picked.has(p.map_id);
        cb.addEventListener("change", () => { if (cb.checked) picked.add(p.map_id); else picked.delete(p.map_id); redraw(); });
        l.appendChild(cb);
        if (urls && urls[p.map_id]) { const im = d("img"); im.src = urls[p.map_id]; im.alt = ""; im.loading = "lazy"; l.appendChild(im); }
        l.appendChild(d("span", null, `${p.name || "a plan"}${p.refs === 0 ? " (placed by eye)" : ""}`));
        sheet.appendChild(l);
      }
      if (list.length > 1) sheet.appendChild(d("div", "pl-note", `${list.length} plans cover ${floorName(fid)}: both are read, and you pick which to trust per item.`));
    }
    // 2. Which kinds.
    sheet.appendChild(d("h5", null, "Which kinds"));
    const kindRow = (key, text, on, disabled, note) => {
      const l = d("label", "pl-tick");
      const cb = d("input"); cb.type = "checkbox"; cb.checked = on; cb.disabled = disabled;
      if (key) cb.addEventListener("change", () => { kinds[key] = cb.checked; redraw(); });
      l.append(cb, d("span", null, text + (note ? ` — ${note}` : "")));
      sheet.appendChild(l);
    };
    kindRow(null, "Stairs", true, true, "always read");
    kindRow("railing", "Railings beside stairs", kinds.railing, false, "a hint beside each staircase found");
    kindRow(null, "Lights", false, true, "comes in a later beta");
    // 3. What to expect.
    const n = picked.size;
    const lo = Math.max(1, Math.round(n * 1.5)), hi = Math.max(lo, n * 4);
    sheet.appendChild(d("div", "pl-note", `About 1-2 staircases and 0-2 railing hints per plan. For your ${n} plan${n === 1 ? "" : "s"}: roughly ${lo}-${hi} items, `
      + `${Math.max(1, n)}-${Math.max(1, n) * 3} minutes to vet.`));
    // 4. Where the plans go.
    sheet.appendChild(d("h5", null, "Where the plans go"));
    const ai = info && info.ai;
    if (!ai || ai.ready === false) sheet.appendChild(d("div", "pl-note pl-bad", (ai && ai.message) || "Pick an AI Task in Settings → AI first."));
    else {
      sheet.appendChild(d("div", "pl-note", planNote(ai, n, backupOk)));
      if (mayLeave(ai, backupOk)) {
        sheet.appendChild(d("div", "pl-note", "A plan with your address on it goes with it; crop it in Mapping → Upload first if you'd rather not."));
        const l = d("label", "pl-tick");
        const cb = d("input"); cb.type = "checkbox"; cb.checked = cloudOk;
        cb.addEventListener("change", () => { cloudOk = cb.checked; });
        l.append(cb, d("span", null, "I understand these plans leave the house"));
        sheet.appendChild(l);
      }
      if (ai.backup) {
        const l = d("label", "pl-tick");
        const cb = d("input"); cb.type = "checkbox"; cb.checked = backupOk;
        cb.addEventListener("change", () => { backupOk = cb.checked; redraw(); });
        l.append(cb, d("span", null, `If the main one is away, let the backup (${ai.backup_name || ai.backup}) read them`));
        sheet.appendChild(l);
      }
    }
    // 5. Go.
    const acts = d("div", "pl-acts");
    const go = btn("", "Start reading", () => start(), "go");
    go.textContent = mayLeave(ai, backupOk) ? `Send ${n} plan${n === 1 ? "" : "s"} to the cloud` : `Read ${n} plan${n === 1 ? "" : "s"}`;
    const blocked = info && info.start_blocked;
    go.disabled = busy || !ai || ai.ready === false || !!blocked || !n || (ai.main_away === true && !backupOk);
    acts.appendChild(go);
    if (sess && Object.keys(sess.suggestions || {}).length) acts.appendChild(btn("Back to the last list", "The last session's items", () => { step = "list"; redraw(); }));
    sheet.appendChild(acts);
    if (blocked) sheet.appendChild(d("div", "pl-note", { already_running: "A session is already reading your plans.", too_soon: "A session started less than a minute ago: wait a moment.",
      daily_cap: "That's the day's sessions: try again tomorrow." }[blocked] || String(blocked)));
  }

  function paintProgress(){
    head("Reading your plans", "The read runs on the server: this page can close and come back.");
    const pr = (sess && sess.progress) || {};
    const name = pr.name || "a plan", i = pr.plan || 0, n = pr.of || (info && info.running ? "?" : 0);
    const what = pr.step === "check" ? `Checking a find on ${name}` : pr.step === "railing" ? `Looking for a railing on ${name}` : `Reading ${name} for stairs`;
    sheet.appendChild(d("div", "pl-sum", `${what} (${i} of ${n})…${pr.step === "stairs" || !pr.step ? " then checking each find." : ""} A local AI can take a minute a read.`));
    if (sess) sheet.appendChild(d("div", "pl-note", `${sess.reads || 0} reads so far, ${mins(sess.spent_s)} spent of ${mins(sess.budget_s)}.`));
    if (cancelNote) sheet.appendChild(d("div", "pl-note", cancelNote));
    errLine();
    const acts = d("div", "pl-acts");
    acts.appendChild(btn("Cancel", "Stop between reads; what was read so far is kept", () => cancel()));
    sheet.appendChild(acts);
  }

  function summary(){
    const ss = sugs();
    const stairs = ss.filter(s => s.kind === "stairs" && s.state !== "duplicate").length;
    const rails = ss.filter(s => s.kind === "railing").length;
    const n = (sess.plans || []).length, skipped = sess.skipped || 0;
    let line = `Found ${stairs} stair${stairs === 1 ? "" : "s"}, ${rails} railing hint${rails === 1 ? "" : "s"} on ${n - skipped} plan${n - skipped === 1 ? "" : "s"} in ${mins(sess.spent_s)}.`;
    if (skipped) line += ` ${skipped} plan${skipped === 1 ? "" : "s"} skipped (out of time).`;
    if (sess.crop_dropped) line += ` ${sess.crop_dropped} left out: a closer look found no staircase there.`;
    if (sess.no_floor) line += ` ${sess.no_floor} left out: no floor below for a staircase to climb from.`;
    if (sess.status === "out_of_time") line += " The session ran out of time.";
    if (sess.status === "cancelled") line += ` The session was ${CANCEL_WORDS[sess.error] || "cancelled"}.`;
    if (sess.status === "failed") line += sess.error === "restart" ? " Home Assistant restarted during the read; run it again." : " The read failed; run it again.";
    if (sess.backup_used) line += " Read by the backup AI task.";
    if (sess.frame === "named") line += " This AI's picture size isn't known, so positions may be coarse.";
    return line + (ss.length ? " Vet them one by one." : "");
  }

  function row(sug, acts){
    const r = d("div", "pl-row");
    const c = d("canvas"); c.width = 240; c.height = 168;
    r.appendChild(c);
    if (urls) drawCrop(c, sug);
    const t = d("div", "pl-txt");
    const g = sug.geom || {}, m = sug.match || {};
    const kind = sug.kind === "railing" ? "Railing hint" : "Stairs";
    const seen = Array.isArray(sug.seen_on) && sug.seen_on.length > 1 ? ` · seen on ${sug.seen_on.length} plans` : ` · ${planName(sug.map_id)}`;
    const size = sug.kind === "stairs" ? ` · ${m1(g.width_m)} × ${m1(g.depth_m)} m` : "";
    const side = sug.kind === "railing" ? (g.side ? ` · the AI says ${g.side}` : " · a rail on one side: which?") : "";
    t.appendChild(d("div", null, `${kind} · ${floorName(sug.floor_id)}${seen}${size}${side}`));
    const rel = d("div", "pl-sub");
    const label = m.target_snap && m.target_snap.label ? m.target_snap.label : "a stair";
    if (sug.state === "stale") rel.appendChild(Object.assign(d("span", "pl-rel stale", movedPlan(sug.map_id) ? "the plan moved: read it again" : "changed since you looked"), { title: "The plan or the stair it points at changed since the read." }));
    else if (m.relation === "correction" && sug.kind === "railing") rel.appendChild(d("span", "pl-rel correction", `correction · a rail on another side of ${label}`));
    else if (m.relation === "correction") rel.appendChild(d("span", "pl-rel correction", `correction · ${m1(m.distance_m)} m from ${label}`));
    else if (m.relation === "stacked") rel.appendChild(d("span", "pl-rel stacked", "a second staircase here, stacked?"));
    else if (m.relation === "new") rel.appendChild(d("span", "pl-rel new", (m.near_names || []).length ? `new · near ${m.near_names.join(" and ")}` : "new"));
    rel.appendChild(document.createTextNode(CUE[sug.kind] || ""));
    t.appendChild(rel);
    if (sug.kind === "stairs" && m.relation === "correction" && m.hand === true) t.appendChild(d("div", "pl-sub", `You placed this one. The AI puts it ${m1(m.distance_m)} m away. Keep yours unless the plan says otherwise.`));
    for (const o of m.others || []) t.appendChild(d("div", "pl-sub", `${planName(o.map_id)} puts one ${m1(o.distance_m)} m from here: both are listed, nothing wins by itself.`));
    if (m.held === "frame" || m.held === "suspect") t.appendChild(d("div", "pl-sub", m.held === "suspect" ? "Position unsure: the AI answered in a 0-1000 frame." : "Position may be coarse: this AI's picture size isn't known."));
    else if (m.held === "eye") t.appendChild(d("div", "pl-sub", "The plan was placed by eye, so the offset may be the plan's."));
    if (sug.verdict && sug.verdict.why) t.appendChild(d("div", "pl-sub", `Marked wrong: ${WHY_WORD[sug.verdict.why] || sug.verdict.why}${sug.verdict.remembered ? " (ignored before)" : ""}`));
    if (acts) t.appendChild(acts);
    r.appendChild(t);
    return r;
  }
  function queuedActs(sug){
    const a = d("div", "pl-acts");
    const bNew = btn("New", NEXT_BETA, () => {}); bNew.disabled = true;
    a.appendChild(bNew);
    if ((sug.match || {}).relation === "correction" && sug.state !== "stale") { const bC = btn("Correction", NEXT_BETA, () => {}); bC.disabled = true; a.appendChild(bC); }
    if (failing === sug.id) {
      for (const [k, word] of WHY) a.appendChild(btn(word, `Mark it wrong: ${word.toLowerCase()}`, () => verdict(sug, "failure", k), "why"));
      a.appendChild(btn("Never mind", "Keep it in the queue", () => { failing = null; redraw(); }));
    } else {
      a.appendChild(btn("Failure", "Mark it wrong, with a reason (noted at once)", () => { failing = sug.id; redraw(); }));
      if (sug.state !== "stale") a.appendChild(btn("Later", "Come back to it (noted at once)", () => verdict(sug, "later")));
    }
    for (const b of a.querySelectorAll("button")) if (!b.disabled) b.disabled = busy;
    return a;
  }
  function backActs(sug){
    const a = d("div", "pl-acts");
    const b = btn("Take that back", "Back to the queue", () => verdict(sug, "back")); b.disabled = busy;
    a.appendChild(b);
    return a;
  }

  function paintList(){
    head("Add data via plans", "The AI's finds, one by one. Nothing is written to your house in this version.");
    sheet.appendChild(d("div", "pl-ban", BANNER));
    sheet.appendChild(d("div", "pl-sum", summary()));
    errLine();
    const ss = sugs();
    const order = (s) => (s.kind === "stairs" ? 0 : 1);
    const group = (title, list, actsOf) => {
      if (!list.length) return;
      sheet.appendChild(d("h5", null, `${title} (${list.length})`));
      for (const s of list.sort((a, b) => order(a) - order(b) || String(a.floor_id).localeCompare(String(b.floor_id)))) sheet.appendChild(row(s, actsOf ? actsOf(s) : null));
    };
    group("To check", ss.filter(s => s.state === "queued"), queuedActs);
    group("Changed since you looked", ss.filter(s => s.state === "stale"), queuedActs);
    group("Later", ss.filter(s => s.state === "later"), backActs);
    group("Marked wrong", ss.filter(s => s.state === "failure" && !(s.verdict && s.verdict.remembered)), backActs);
    group("Already in your house", ss.filter(s => s.state === "duplicate"), null);
    group("Ignored before", ss.filter(s => s.state === "failure" && s.verdict && s.verdict.remembered),
      (s) => { const a = d("div", "pl-acts"); const b = btn("Un-ignore", "Forget that reject and queue it again", () => forget(s.verdict.reject)); b.disabled = busy; a.appendChild(b); return a; });
    if (!ss.length) sheet.appendChild(d("div", "pl-note", "The AI found nothing on these plans."));
    const foot = d("div", "pl-foot");
    foot.appendChild(btn("Manage ignored", "The finds you marked wrong, remembered per plan", () => openIgnored()));
    foot.appendChild(btn("Read again", "Back to the plans and the button", () => readAgain()));
    sheet.appendChild(foot);
  }

  function paintIgnored(){
    head("Ignored before", "Finds you marked wrong, remembered for that plan until it is moved or replaced.");
    errLine();
    if (ignored === null) sheet.appendChild(d("div", "pl-note", "Loading…"));
    else if (!ignored.length) sheet.appendChild(d("div", "pl-note", "Nothing is ignored."));
    for (const r of ignored || []) {
      const rowEl = d("div", "pl-row");
      const t = d("div", "pl-txt");
      t.appendChild(d("div", null, `${r.kind === "railing" ? "Railing hint" : "Stairs"} · ${r.plan || "a plan"} · ${floorName(r.floor_id)} · at ${m1(r.x_m)}, ${m1(r.y_m)} m`));
      t.appendChild(d("div", "pl-sub", `Marked wrong: ${WHY_WORD[r.why] || r.why || "no reason given"}`));
      const a = d("div", "pl-acts");
      const b = btn("Forget", "Queue it again next time", () => forget(r.key)); b.disabled = busy;
      a.appendChild(b);
      t.appendChild(a);
      rowEl.appendChild(t);
      sheet.appendChild(rowEl);
    }
    const foot = d("div", "pl-foot");
    foot.appendChild(btn("Back", "Back to the list", () => { view = "list"; redraw(); }));
    sheet.appendChild(foot);
  }

  function paint(){
    sheet.classList.add("plans");
    if (view === "ignored") { paintIgnored(); return true; }
    if (step === "loading") { head("Add data via plans"); sheet.appendChild(d("div", "pl-note", "Looking for your plans…")); return true; }
    if (step === "sample") { head("Add data via plans"); sheet.appendChild(d("div", "pl-note", "Sample mode shows a sample house: switch to Live mode to read your own plans.")); return true; }
    if (step === "progress") { paintProgress(); return true; }
    if (step === "list" && sess) { paintList(); return true; }
    paintConsent();
    return true;
  }

  return {
    /** The Plans tool on (the editor's tool) or off. */
    show(on){
      on = !!on;
      if (on === shownNow) return;
      shownNow = on;
      if (on) { view = "list"; failing = null; open(); }
      else { stopPoll(); sheet.classList.remove("plans"); }
    },
    /** The sheet's content for the step we are at; true: there is one. */
    sheet: () => paint(),
    dispose(){ stopPoll(); shownNow = false; try { style.remove(); } catch (_) { /* gone with its root */ } },
  };
}
