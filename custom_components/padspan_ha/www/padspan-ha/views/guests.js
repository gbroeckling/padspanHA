// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Guests (0.38.178, guest_tags.py): tags lent to guests, and their stays.
 *
 * A guest tag is a device PadSpan already knows under a name the owner gave
 * it ("Guest tag 1"). Lending it starts a stay: who has it, until when, the
 * rooms they should not go into, and the notices wanted. The stay's report —
 * arrived, left, time in each room, off-limits visits — is kept the days set
 * in Settings → Presence → Guest tags. The tab exists only while guest tags
 * are on.
 */

const REFRESH_MS = 10000;
const AMBER = "#fbbf24";

const _pad = (n) => String(n).padStart(2, "0");
function _when(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function _dur(s) {
  s = Math.max(0, Math.round(s || 0));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 48) return mm ? `${h} h ${mm} min` : `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
const _localInput = (ts) => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}`; };

export function render(ctx) {
  const { el } = ctx.helpers;
  const root = el("div", { id: "guests" });
  root.appendChild(el("div", { style: "margin-bottom:14px" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px" }, [
      el("div", { style: "font-size:24px" }, "🧳"),
      el("div", { style: `font-weight:700;font-size:16px;color:${AMBER}` }, "Guests"),
    ]),
    el("div", { style: "font-size:12px;color:#94a3b8;margin-top:2px" },
      "Lend a tag to a guest: see where they are, when they came and went, and be told when they go somewhere they shouldn't."),
  ]));
  const content = el("div", {});
  root.appendChild(content);
  const gs = ctx.state._guests || (ctx.state._guests = { data: null, ts: 0 });
  if (gs.data) _draw(ctx, el, content, gs.data);
  else content.appendChild(el("div", { style: "text-align:center;color:#94a3b8;padding:20px" }, "Loading…"));
  if (!gs.data || Date.now() - gs.ts > REFRESH_MS) _load(ctx);
  return root;
}

async function _load(ctx) {
  const gs = ctx.state._guests;
  if (gs.loading) return;
  gs.loading = true;
  try {
    gs.data = await ctx.actions.callWS({ type: "padspan_ha/guests_get" });
    gs.ts = Date.now();
    gs.error = null;
  } catch (e) {
    gs.error = String(e?.message || e);
    gs.data = gs.data || { enabled: true, tags: [], sessions: [], candidates: [], error: gs.error };
  } finally {
    gs.loading = false;
  }
  if (ctx.state.view === "guests") ctx.actions.renderRooms();
}

async function _call(ctx, msg, okText) {
  try {
    const r = await ctx.actions.callWS(msg);
    if (okText) ctx.toast(okText);
    ctx.state._guests.ts = 0;
    await _load(ctx);
    return r;
  } catch (e) {
    ctx.toast(e?.message || e?.code || String(e), true);
    return null;
  }
}

const _card = (el, title, kids, color) => el("div", { class: "card", style: "margin-bottom:12px" + (color ? `;border-color:${color}55` : "") }, [
  el("div", { style: "font-weight:700;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px" }, title),
  ...kids,
]);
const _chip = (el, text, color) => el("span", { style: `display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid ${color}88;color:${color};background:${color}14;margin-left:6px` }, text);

function _draw(ctx, el, content, data) {
  content.innerHTML = "";
  if (!data.enabled) {
    content.appendChild(_card(el, "Guest tags are off", [
      el("div", { class: "muted", style: "font-size:13px;margin-bottom:10px" }, "Turn them on in Settings → Presence → Guest tags."),
      el("button", { class: "btn", onclick: () => { ctx.state.view = "settings"; ctx.state._settingsTab = "presence"; ctx.actions.renderRooms(); } }, "Open Settings"),
    ]));
    return;
  }
  if (data.error) content.appendChild(el("div", { style: "color:#f87171;font-size:12px;margin-bottom:8px" }, "Could not load: " + data.error));
  const isAdmin = !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
  const running = (data.sessions || []).filter(s => !s.ended);
  const done = (data.sessions || []).filter(s => s.ended);

  // ── Stays running now ─────────────────────────────────────────────────
  if (running.length) {
    content.appendChild(_card(el, `Staying now (${running.length})`, running.map(s => _runningRow(ctx, el, s, isAdmin)), AMBER));
  }

  // ── The tags ──────────────────────────────────────────────────────────
  const tagRows = (data.tags || []).map(t => {
    const lent = !!t.session;
    return el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid #1b3526" }, [
      el("div", { style: "flex:1;min-width:180px" }, [
        el("span", { style: "font-weight:600;color:#e2e8f0" }, t.label),
        lent ? _chip(el, `with ${t.guest}`, AMBER) : _chip(el, "in the drawer", "#94a3b8"),
        el("div", { class: "muted", style: "font-size:11px;margin-top:2px" },
          (t.present ? `Heard now${t.room ? " · " + t.room : ""}` : "Not heard now") + ` · ${t.kind}`),
      ]),
      isAdmin && !lent ? el("button", { class: "btn inline primary", onclick: () => _lendModal(ctx, el, t) }, "Lend to a guest") : null,
      isAdmin && !lent ? el("button", { class: "btn inline", onclick: async () => {
        if (confirm(`Stop using ${t.label} as a guest tag? Its name and history stay; finished stays' reports are kept.`)) await _call(ctx, { type: "padspan_ha/guest_tag_unmark", pid: t.pid }, "Removed from guest tags");
      } }, "Not a guest tag") : null,
    ]);
  });
  const addRow = [];
  if (isAdmin) {
    const cands = data.candidates || [];
    if (cands.length) {
      const sel = el("select", { class: "select", style: "width:auto;min-width:200px" });
      for (const c of cands) sel.appendChild(el("option", { value: c.key }, `${c.label}${c.room ? " (" + c.room + ")" : ""}`));
      addRow.push(el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px" }, [
        el("span", { style: "font-size:12px;color:#94a3b8" }, "Use as a guest tag:"), sel,
        el("button", { class: "btn inline", onclick: () => _call(ctx, { type: "padspan_ha/guest_tag_mark", key: sel.value }, "Added to guest tags") }, "Add"),
      ]));
    }
    addRow.push(el("div", { class: "muted", style: "font-size:11px;margin-top:6px" },
      "A guest tag is a device you have already named (Follow or Devices → Rename), so give a spare tag a name like \"Guest tag 1\" first. " +
      "A phone works too; a tag with a steady identity (a beacon, a Find My tag, a phone with Private BLE) works best."));
  }
  content.appendChild(_card(el, "Guest tags", [
    ...(tagRows.length ? tagRows : [el("div", { class: "muted", style: "font-size:13px" }, "No guest tags yet.")]),
    ...addRow,
  ]));

  // ── Finished stays: their reports ─────────────────────────────────────
  content.appendChild(_card(el, `Past stays (${done.length})`, done.length
    ? done.map(s => _report(ctx, el, s, isAdmin))
    : [el("div", { class: "muted", style: "font-size:13px" }, `None kept. Finished stays are kept ${data.retention_days ? data.retention_days + " days" : "not at all"} (Settings → Presence → Guest tags).`)]));
}

function _runningRow(ctx, el, s, isAdmin) {
  const sum = s.summary || {};
  const off = (s.opts && s.opts.off_limits) || [];
  return el("div", { style: "padding:8px 0;border-top:1px solid #1b3526" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, [
      el("span", { style: "font-weight:700;color:#e2e8f0;font-size:14px" }, s.name),
      _chip(el, s.tag || "tag", AMBER),
      s.present ? _chip(el, s.room ? `in the ${s.room}` : "here", "#52b788") : _chip(el, "not heard now", "#94a3b8"),
      s.room && off.includes(s.room) ? _chip(el, "off-limits room", "#f87171") : null,
    ]),
    el("div", { class: "muted", style: "font-size:12px;margin-top:4px;line-height:1.5" },
      `Since ${_when(s.start)}` + (s.end_planned ? ` · until ${_when(s.end_planned)}` : " · no end set") +
      ` · ${_dur(sum.length_s)} so far` + (off.length ? ` · off-limits: ${off.join(", ")}` : "") +
      (sum.notices ? ` · ${sum.notices} notice${sum.notices === 1 ? "" : "s"}` : "")),
    _roomsLine(el, sum),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:6px" }, [
      isAdmin ? el("button", { class: "btn inline primary", onclick: async () => {
        if (confirm(`${s.name}'s tag is back? This ends the stay and keeps its report.`)) await _call(ctx, { type: "padspan_ha/guest_session_end", session: s.id }, "Stay ended — tag back in the drawer");
      } }, "Tag returned") : null,
      isAdmin ? el("button", { class: "btn inline", onclick: () => _lendModal(ctx, el, { pid: s.pid, label: s.tag }, s) }, "Change") : null,
      el("button", { class: "btn inline", onclick: () => _toTraceback(ctx, s) }, "Traceback"),
    ]),
  ]);
}

function _roomsLine(el, sum) {
  const rooms = Object.entries(sum.rooms || {}).sort((a, b) => b[1] - a[1]);
  if (!rooms.length) return null;
  return el("div", { style: "font-size:12px;color:#b0c4b1;margin-top:4px" },
    "Time in rooms: " + rooms.slice(0, 8).map(([r, s]) => `${r} ${_dur(s)}`).join(" · ") + (rooms.length > 8 ? ` · +${rooms.length - 8}` : ""));
}

function _report(ctx, el, s, isAdmin) {
  const sum = s.summary || {};
  const how = { manual: "tag returned", scheduled: "ended at its planned time", stale: "ended after a week unheard" }[s.end_how] || "ended";
  const offs = sum.off_limits || [];
  return el("details", { style: "padding:6px 0;border-top:1px solid #1b3526" }, [
    el("summary", { style: "cursor:pointer;font-size:13px;color:#e2e8f0" }, [
      el("span", { style: "font-weight:600" }, s.name), " ", el("span", { class: "muted", style: "font-size:12px" },
        `· ${s.tag || "tag"} · ${_when(s.start)} – ${_when(s.ended)} · ${_dur(sum.length_s)}`),
    ]),
    el("div", { style: "font-size:12px;color:#b0c4b1;line-height:1.6;margin:6px 0 0 14px" }, [
      el("div", {}, `First in ${_when(sum.first_in)} · last out ${_when(sum.last_out)} · ${sum.arrivals || 0} return${sum.arrivals === 1 ? "" : "s"} · ${sum.departures || 0} time${sum.departures === 1 ? "" : "s"} out · ${how}`),
      _roomsLine(el, sum),
      offs.length ? el("div", { style: "color:#fca5a5" }, "Off-limits visits: " + offs.map(([t, r]) => `${r} (${_when(t)})`).join(", ")) : null,
      el("div", { class: "muted" }, `${sum.notices || 0} notice${sum.notices === 1 ? "" : "s"} sent`),
      el("div", { style: "display:flex;gap:8px;margin-top:6px" }, [
        el("button", { class: "btn inline", onclick: () => _toTraceback(ctx, s) }, "Traceback"),
        isAdmin ? el("button", { class: "btn inline", onclick: async () => {
          if (confirm(`Delete ${s.name}'s stay now, name and report?`)) await _call(ctx, { type: "padspan_ha/guest_session_forget", session: s.id }, "Stay deleted");
        } }, "Forget") : null,
      ]),
    ]),
  ]);
}

/** Traceback for the tag over the stay (views/traceback.js reads the preset once). */
function _toTraceback(ctx, s) {
  const tag = ((ctx.state._guests.data || {}).tags || []).find(t => t.pid === s.pid);
  const key = (tag && (tag.keys || [])[0]) || s.pid;
  ctx.state._tracebackPreset = { key, start_ms: Math.round((s.start || 0) * 1000), end_ms: Math.round((s.ended || Date.now() / 1000) * 1000) };
  ctx.state.view = "traceback";
  ctx.actions.renderRooms();
}

function _lendModal(ctx, el, tag, existing) {
  const o = (existing && existing.opts) || { notify_arrive: true, notify_leave: true };
  const body = el("div", { style: "display:flex;flex-direction:column;gap:12px;min-width:min(90vw,460px)" });
  const lbl = (t) => el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:4px" }, t);
  const input = (type, val, ph) => { const i = document.createElement("input"); i.type = type; i.className = "select"; i.style.cssText = "width:100%;box-sizing:border-box"; if (val) i.value = val; if (ph) i.placeholder = ph; return i; };
  const name = input("text", existing ? existing.name : "", "Guest's name");
  name.maxLength = 60;
  const end = input("datetime-local", existing && existing.end_planned ? _localInput(existing.end_planned) : "");
  body.appendChild(el("div", {}, [lbl(`Who has ${tag.label}?`), name]));
  body.appendChild(el("div", {}, [lbl("Until (optional — the stay ends by itself then)"), end]));

  // Off-limits rooms: the house's rooms (Home Assistant areas).
  const areas = ((ctx.state.model && ctx.state.model.areas) || []).map(a => (typeof a === "string" ? a : a.name)).filter(Boolean).sort();
  const offSet = new Set(o.off_limits || []);
  const offBox = el("div", { style: "display:flex;flex-wrap:wrap;gap:6px 12px;max-height:140px;overflow:auto" });
  const offChecks = [];
  for (const a of areas) {
    const c = document.createElement("input"); c.type = "checkbox"; c.checked = offSet.has(a); c.value = a;
    offChecks.push(c);
    offBox.appendChild(el("label", { style: "font-size:12px;color:#e2e8f0;display:flex;gap:4px;align-items:center" }, [c, a]));
  }
  body.appendChild(el("div", {}, [lbl("Rooms they shouldn't go into (you're told if they're there for half a minute)"),
    areas.length ? offBox : el("div", { class: "muted", style: "font-size:12px" }, "No rooms in Home Assistant yet.")]));

  const check = (on, text) => { const c = document.createElement("input"); c.type = "checkbox"; c.checked = !!on; return [c, el("label", { style: "font-size:13px;color:#e2e8f0;display:flex;gap:6px;align-items:center" }, [c, text])]; };
  const [arr, arrL] = check(o.notify_arrive, "Tell me when they arrive");
  const [lv, lvL] = check(o.notify_leave, "Tell me when they leave");
  const [home, homeL] = check(o.counts_home, "Staying here (a house-sitter): counts as someone home for Vacation Mode");
  body.appendChild(el("div", { style: "display:flex;flex-direction:column;gap:6px" }, [arrL, lvL, homeL]));

  const target = el("select", { class: "select", style: "width:100%" });
  target.appendChild(el("option", { value: "" }, "A Home Assistant notification"));
  const fill = (list) => { for (const svc of list || []) target.appendChild(el("option", { value: svc }, svc)); target.value = o.notify_target || ""; };
  if (Array.isArray(ctx.state._notifyServices) && ctx.state._notifyServices.length) fill(ctx.state._notifyServices);
  else ctx.actions.wsCall("padspan_ha/notify_services_list", {}).then(r => { ctx.state._notifyServices = (r && r.services) || []; fill(ctx.state._notifyServices); }).catch(() => {});
  body.appendChild(el("div", {}, [lbl("Send notices to"), target]));

  const [qa, qb] = String(o.quiet || "").split("-");
  const qFrom = input("time", qa || ""), qTo = input("time", qb || "");
  qFrom.style.width = qTo.style.width = "auto";
  body.appendChild(el("div", {}, [lbl("Quiet hours (no arrive/leave notices then; off-limits ones still come)"),
    el("div", { style: "display:flex;gap:8px;align-items:center" }, [qFrom, el("span", { class: "muted" }, "to"), qTo])]));

  body.appendChild(el("div", { style: "font-size:12px;color:#fcd34d;border:1px solid #b45309;border-radius:6px;padding:6px 8px;background:rgba(180,83,9,.12)" },
    "Tell your guest this tag is tracked while they have it."));
  const status = el("div", { style: "font-size:12px;color:#f87171;min-height:16px" }, "");
  const go = el("button", { class: "btn primary", onclick: async () => {
    const nm = name.value.trim();
    if (!nm) { status.textContent = "A name is needed."; return; }
    const quiet = qFrom.value && qTo.value ? `${qFrom.value}-${qTo.value}` : "";
    const opts = { off_limits: offChecks.filter(c => c.checked).map(c => c.value), notify_arrive: arr.checked,
      notify_leave: lv.checked, notify_target: target.value, quiet, counts_home: home.checked };
    const endAt = end.value ? Math.round(new Date(end.value).getTime() / 1000) : null;
    go.disabled = true;
    const r = existing
      ? await _call(ctx, { type: "padspan_ha/guest_session_update", session: existing.id, name: nm, end_at: endAt, ...opts }, "Stay updated")
      : await _call(ctx, { type: "padspan_ha/guest_session_start", pid: tag.pid, name: nm, end_at: endAt, ...opts }, `${tag.label} lent to ${nm}`);
    go.disabled = false;
    if (r) ctx.actions.closeModal();
  } }, existing ? "Save" : "Start the stay");
  body.appendChild(el("div", { style: "display:flex;gap:8px;justify-content:flex-end" }, [
    el("button", { class: "btn", onclick: () => ctx.actions.closeModal() }, "Cancel"), go]));
  body.appendChild(status);
  ctx.actions.openModal(existing ? `${existing.name}'s stay` : `Lend ${tag.label}`, body);
}
