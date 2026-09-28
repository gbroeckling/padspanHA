// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * WLED workbench — Sync & team.
 *
 * Sync: WLED's own UDP sync groups (1-8), as a person thinks of them —
 * "send my changes to group 2", "listen to group 2" — not bitmasks. The
 * live switches (state.udpn) are anyone's; saving them for the next boot
 * (cfg if.sync) is an administrator's.
 *
 * Team (Garry, 2026-09-23: "include teaming with other wled devices for
 * proper light control in HA"): a leader and followers joined by one sync
 * group. The card sets the group on every device — each through the safe
 * config write, so each device is backed up first — and PadSpan records the
 * team, so Home Assistant needs only the leader: change it (from HA, the
 * Atlas, anywhere) and the followers follow over WLED sync, while Vacation
 * Mode leaves the followers to it instead of fighting it (vacation_mode.py).
 *
 * Who gives the light its instructions (Garry, 2026-09-27: "switch off
 * WLED's own join/sync and use a PadSpan join where all instructions come
 * from PadSpan"): WLED sync, or PadSpan — which switches this device's sync
 * off (saved first, put back on the way back) and sends its whole remembered
 * look every time it turns it on (wled_exact.py, wled_tab_look.js). A team
 * can be run the same way: every member gets its own look at once.
 */

const _q = new URL(import.meta.url).search;
const M = await import(`./wled_model.js${_q}`);
const { C, S, h, check, select, numberBox, errText, reportCfg } = await import(`./wled_ui.js${_q}`);
const { rememberLook } = await import(`./wled_tab_look.js${_q}`);

const GROUPS = [1, 2, 3, 4, 5, 6, 7, 8];

function groupChips(mask, onChange, disabled) {
  const on = new Set(M.groupsOf(mask));
  return h("span", { style: "display:inline-flex;gap:4px;flex-wrap:wrap" }, GROUPS.map(g => h("button", {
    style: (on.has(g) ? S.btnOn : S.btn) + ";padding:3px 9px" + (disabled ? ";opacity:.5;cursor:default" : ""),
    onclick: () => {
      if (disabled) return;
      if (on.has(g)) on.delete(g); else on.add(g);
      onChange(M.maskOf([...on]));
    },
  }, String(g))));
}

async function deviceCfg(ctx, deviceId) {
  const r = await ctx.hass.callWS({ type: "padspan_ha/wled_get", device_id: deviceId, path: "json/cfg" });
  return { cfg: r.data || {}, hash: r.hash };
}
async function deviceInfo(ctx, deviceId) {
  return (await ctx.hass.callWS({ type: "padspan_ha/wled_get", device_id: deviceId, path: "json/info" })).data || {};
}
async function deviceState(ctx, deviceId, body) {
  return ctx.hass.callWS({ type: "padspan_ha/wled_state", device_id: deviceId, body });
}
// `baseHash`: the settings version the write was built from — a device
// changed since then is refused rather than overwritten (round 7).
async function deviceCfgWrite(ctx, deviceId, patch, baseHash) {
  const hash = baseHash || (await deviceCfg(ctx, deviceId)).hash;
  return ctx.hass.callWS({ type: "padspan_ha/wled_cfg", device_id: deviceId, patch, base_hash: hash });
}
// Run a team by PadSpan or by WLED sync (wled_exact.py switches every
// member's sync with it, rolling back if one fails). null when it failed.
async function teamMode(ctx, team, mode) {
  try { return await ctx.hass.callWS({ type: "padspan_ha/wled_team_mode", team_id: team.id, mode }); }
  catch (e) {
    ctx.toast((mode === "padspan" ? "Couldn't hand the team to PadSpan: " : "Couldn't switch the team back to WLED sync: ")
      + errText(e) + (e && e.code === "no_look" ? " — press Remember team look on the Exact look tab" : ""), true);
    return null;
  }
}

export function syncView(ctx) {
  const root = h("div");
  const join = h("div");
  root.appendChild(join);
  const live = h("div");
  root.appendChild(live);
  const saved = h("div");
  root.appendChild(saved);
  const team = h("div");
  root.appendChild(team);
  const nodes = h("div");
  root.appendChild(nodes);
  // The sync cards wait for who runs the light: while PadSpan does, they
  // are read-only — a sync change there would undo PadSpan's switch-off.
  (async () => {
    let x = null;
    try { x = await ctx.call("padspan_ha/wled_look_get", {}); }
    catch (e) { x = null; }
    ctx.exact = x;
    const locked = !!(x && x.join === "padspan");
    joinCard(ctx, join, x);
    live.appendChild(liveSyncCard(ctx, locked));
    savedSyncCard(ctx, saved, locked);
  })();
  teamCard(ctx, team);
  nodesCard(ctx, nodes);
  return root;
}

// ── Who gives this light its instructions ──
const WLED_SYNC_TEXT = "Other WLED lights can change this one.";
const PADSPAN_TEXT = "PadSpan sends every setting each time this light turns on, so it looks the same every time. "
  + "WLED's own sync is switched off on this device, and put back if you switch back.";
const TEAM_PADSPAN_TEXT = "Every member gets its own remembered look at the same moment. WLED sync is switched off on the members.";
// A member of a WLED sync team goes over with its team: on its own it would
// leave the team's group, or (the leader) stop the others following.
const IN_WLED_TEAM_TEXT = "It's in a WLED sync team — run the team by PadSpan on the Team card below.";

const groupWords = (mask) => {
  const g = M.groupsOf(mask);
  return g.length ? `group${g.length > 1 ? "s" : ""} ${g.join(", ")}` : null;
};
// A device's sync, before or after a switch, as a person reads it.
function savedWords(b) {
  if (!b) return "?";
  const send = b.send || {}, recv = b.recv || {};
  const to = send.en !== false && groupWords(send.grp);
  return `${to ? `sends to ${to}` : "doesn't send"}; ${groupWords(recv.grp) ? `follows ${groupWords(recv.grp)}` : "follows nothing"}`;
}
function liveWords(l) {
  if (!l) return "?";
  const to = l.send && groupWords(l.sgrp);
  return `${to ? `sends to ${to}` : "doesn't send"}; ${groupWords(l.rgrp) ? `follows ${groupWords(l.rgrp)}` : "follows nothing"}`;
}

function joinCard(ctx, host, x) {
  host.innerHTML = "";
  const card = h("div", { style: S.card + `;border-color:${C.purple}` });
  host.appendChild(card);
  card.appendChild(h("div", { style: "font-weight:700;margin-bottom:6px" }, "Who gives this light its instructions"));
  if (!x || typeof x !== "object" || !("join" in x)) {
    card.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` }, "Couldn't read how this light is run."));
    return;
  }
  const padspan = x.join === "padspan";
  const teamRuns = x.team_mode === "padspan";
  const inWledTeam = !!x.team_id && !teamRuns;
  const canSwitch = ctx.isAdmin && !teamRuns && !ctx.joinBusy;
  const choice = (selected, label, to, blocked) => h("button", {
    style: (selected ? S.btnOn : S.btn) + (!selected && (!canSwitch || blocked) ? ";opacity:.5;cursor:default" : ""),
    title: blocked || undefined,
    onclick: () => { if (!selected && canSwitch && !blocked) switchJoin(ctx, to); },
  }, label);
  card.appendChild(h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px" }, [
    choice(!padspan, "WLED sync", "wled"),
    choice(padspan, "PadSpan (exact look)", "padspan", !x.look ? "Remember the look first" : inWledTeam ? IN_WLED_TEAM_TEXT : null),
  ]));
  card.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` }, padspan ? PADSPAN_TEXT : WLED_SYNC_TEXT));
  if (x.sync_off_message) card.appendChild(h("div", { style: `font-size:12px;color:${C.amber};margin-top:4px` }, "⚠ " + x.sync_off_message));
  if (ctx.joinBusy) card.appendChild(h("div", { style: `font-size:12px;color:${C.amber};margin-top:4px` }, "Switching…"));
  if (teamRuns) card.appendChild(h("div", { style: `font-size:12px;color:${C.dim};margin-top:4px` },
    "Its team is run by PadSpan — change that on the Team card below."));
  else if (inWledTeam && !padspan) card.appendChild(h("div", { style: `font-size:12px;color:${C.dim};margin-top:4px` }, IN_WLED_TEAM_TEXT));
  else if (!ctx.isAdmin) card.appendChild(h("div", { style: `font-size:11px;color:${C.faint};margin-top:4px` }, "An administrator chooses this."));
  if (!padspan && !x.look) {
    card.appendChild(h("div", { style: `font-size:12px;color:${C.dim};margin-top:6px` }, "PadSpan needs a remembered look first."));
    if (ctx.isAdmin) card.appendChild(h("button", { style: S.btnPrimary + ";margin-top:6px",
      onclick: async () => { if (await rememberLook(ctx)) ctx.repaint(); } }, "Remember the look as it is now"));
  }
  const r = ctx.joinReport;
  if (r && (r.before || r.after)) {
    const box = h("div", { style: `font-size:12px;margin-top:8px;padding-top:6px;border-top:1px solid ${C.line}` });
    box.appendChild(h("div", { style: S.lbl }, "Sync settings, before → after" + (r.backup ? " (a backup was taken first)" : "")));
    box.appendChild(h("div", {}, `Saved: ${savedWords(r.before)} → ${savedWords(r.after)}`));
    box.appendChild(h("div", {}, `Right now: ${liveWords(r.before && r.before.live)} → ${liveWords(r.after && r.after.live)}`));
    if (r.message) box.appendChild(h("div", { style: `color:${C.amber}` }, "⚠ " + r.message));
    card.appendChild(box);
  }
}

async function switchJoin(ctx, to) {
  const toPadspan = to === "padspan";
  if (!confirm(toPadspan
    ? "Let PadSpan give this light its instructions?\n\nWLED's own sync is switched off on this device — its sync settings are "
      + "kept, and a backup is taken first — and PadSpan sends the remembered look every time it turns the light on."
    : "Give this light back to WLED sync?\n\nThe sync settings it had before PadSpan are put back.")) return;
  ctx.joinBusy = true;
  ctx.joinReport = null;
  ctx.repaint();
  try {
    ctx.joinReport = await ctx.call("padspan_ha/wled_exact_set", { exact: toPadspan });
    ctx.toast(toPadspan ? "PadSpan gives this light its instructions now" : "WLED sync gives this light its instructions again");
    ctx.onExactChanged();
  } catch (e) { ctx.toast("Couldn't switch: " + errText(e), true); }
  finally { ctx.joinBusy = false; }
  // The device's live sync changed: read it again before painting.
  await ctx.reload();
}

// ── Live sync (state.udpn) ──
// "Send my changes" is anyone's (live, unsaved); the group numbers are an
// administrator's — the next settings save would make them permanent
// (round 5). Non-admins see the groups, can't change them.
function liveSyncCard(ctx, locked) {
  const u = ctx.state.udpn || {};
  const card = h("div", { style: S.card });
  card.appendChild(h("div", { style: "font-weight:700;margin-bottom:6px" }, "Sync — right now"));
  if (locked) card.appendChild(h("div", { style: `font-size:12px;color:${C.amber};margin-bottom:4px` }, "Switched off by PadSpan"));
  const write = (patch) => ctx.write({ udpn: patch }, "change sync");
  const sendBox = check("Send my changes", u.send, v => write({ send: v }), "Other WLED devices listening to these groups follow this one");
  if (locked) sendBox.firstChild.disabled = true;
  card.appendChild(h("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0" }, [
    sendBox,
    h("span", { style: `font-size:12px;color:${C.dim}` }, "to groups"),
    groupChips(u.sgrp, v => write({ send: !!u.send, sgrp: v, rgrp: u.rgrp || 0 }), !ctx.isAdmin || locked),
  ]));
  card.appendChild(h("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0" }, [
    h("span", { style: `font-size:12px;color:${C.dim};margin-right:8px` }, "Follow changes from groups"),
    groupChips(u.rgrp, v => write({ send: !!u.send, sgrp: u.sgrp || 0, rgrp: v }), !ctx.isAdmin || locked),
  ]));
  if (!locked) card.appendChild(h("div", { style: `font-size:11px;color:${C.faint};margin-top:4px` },
    "These act now, until the device restarts. A settings save can make them permanent."
    + (ctx.isAdmin ? "" : " An administrator changes the groups.")));
  return card;
}

// ── Saved sync settings (cfg if.sync) ──
async function savedSyncCard(ctx, host, locked) {
  host.innerHTML = "";
  const card = h("div", { style: S.card });
  host.appendChild(card);
  card.appendChild(h("div", { style: "font-weight:700;margin-bottom:6px" }, "Sync — saved for the next boot"));
  if (locked) card.appendChild(h("div", { style: `font-size:12px;color:${C.amber};margin-bottom:4px` }, "Switched off by PadSpan"));
  let cfg, hash;
  try { ({ data: cfg, hash } = await ctx.call("padspan_ha/wled_get", { path: "json/cfg" })); }
  catch (e) { card.appendChild(h("div", { style: `color:${C.red};font-size:12px` }, "Couldn't read the settings: " + errText(e))); return; }
  const sync = JSON.parse(JSON.stringify((cfg.if && cfg.if.sync) || {}));
  const recv = sync.recv || (sync.recv = {}), send = sync.send || (sync.send = {});
  const ro = !ctx.isAdmin || locked;
  const opt = (obj, key, label, title) => {
    if (!(key in obj)) return null;
    const c = check(label, obj[key], v => { obj[key] = v; }, title);
    if (locked) c.firstChild.disabled = true;
    return c;
  };
  card.appendChild(h("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0" }, [
    h("span", { style: `font-size:12px;color:${C.dim}` }, "Send to groups"), groupChips(send.grp, v => { send.grp = v; }, ro),
  ]));
  card.appendChild(h("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0" }, [
    h("span", { style: `font-size:12px;color:${C.dim}` }, "Follow groups"), groupChips(recv.grp, v => { recv.grp = v; }, ro),
  ]));
  card.appendChild(h("div", { style: S.lbl + ";margin-top:8px" }, "When following, take"));
  card.appendChild(h("div", {}, [opt(recv, "bri", "Brightness"), opt(recv, "col", "Colour"), opt(recv, "fx", "Effect"),
    opt(recv, "pal", "Palette"), opt(recv, "seg", "Segment options", "Reverse, mirror, etc."), opt(recv, "sb", "Segment bounds")].filter(Boolean)));
  card.appendChild(h("div", { style: S.lbl + ";margin-top:8px" }, "Send when"));
  card.appendChild(h("div", {}, [opt(send, "en", "Sending is on"), opt(send, "dir", "Changed directly"), opt(send, "btn", "A button is pressed"),
    opt(send, "va", "Alexa changes it"), opt(send, "hue", "Hue sync changes it")].filter(Boolean)));
  if ("ret" in send) {
    const retries = numberBox(send.ret, v => { send.ret = v; }, { max: 30 });
    retries.disabled = !!locked;
    card.appendChild(h("div", { style: "display:flex;gap:6px;align-items:center;margin-top:6px" },
      [h("span", { style: `font-size:12px;color:${C.dim}` }, "Retries"), retries]));
  }
  card.appendChild(h("div", { style: `font-size:11px;color:${C.faint};margin-top:6px` },
    `Sync port ${sync.port0 ?? 21324}${sync.port1 !== undefined ? ` · ${sync.port1}` : ""} — ports are changed on the device's own Sync page (they need a restart).`));
  if (ctx.isAdmin && !locked) card.appendChild(h("button", { style: S.btnPrimary + ";margin-top:8px", onclick: async () => {
    try {
      const r = await ctx.call("padspan_ha/wled_cfg", { patch: { if: { sync: { send, recv } } }, base_hash: hash });
      reportCfg(ctx, r, "Sync settings saved");
      savedSyncCard(ctx, host, locked);
    } catch (e) { ctx.toast("Couldn't save: " + errText(e), true); }
  } }, "Save"));
}

// ── Teams ──
async function teamCard(ctx, host) {
  // A repaint (a header write, a tab switch) builds a new card while a run
  // may still be changing devices: the run's state lives on ctx, and the
  // run refreshes whichever card is showing when it ends (round 7).
  ctx.teamHost = host;
  host.innerHTML = "";
  const card = h("div", { style: S.card + `;border-color:${C.purple}` });
  host.appendChild(card);
  card.appendChild(h("div", { style: "font-weight:700;margin-bottom:6px" }, "Team — WLED devices that act as one light"));
  let teams, devices, listHash;
  try {
    let got;
    [got, { devices }] = await Promise.all([
      ctx.hass.callWS({ type: "padspan_ha/wled_teams_get" }),
      ctx.hass.callWS({ type: "padspan_ha/wled_devices" }),
    ]);
    teams = got.teams; listHash = got.hash;
  } catch (e) { card.appendChild(h("div", { style: `color:${C.red};font-size:12px` }, "Couldn't read teams: " + errText(e))); return; }
  const me = devices.find(d => d.lights.includes(ctx.eid));
  if (!me) { card.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` }, "This light's device isn't in Home Assistant's WLED integration.")); return; }
  const nameOf = (id) => (devices.find(d => d.device_id === id) || {}).name || "a removed device";
  // The whole list is replaced on each save: sent with the version this card
  // read, so another window's change is refused rather than dropped (round 6).
  const saveTeams = async (list) => {
    const r = await ctx.hass.callWS({ type: "padspan_ha/wled_teams_set", teams: list, ...(listHash ? { base_hash: listHash } : {}) });
    listHash = r && r.hash; teams = (r && r.teams) || list;
    return r;
  };
  // One thing at a time: a second press while devices are being changed
  // would read the first run's half-done state as the "before" (round 6).
  const buttons = [];
  const busy = async (fn) => {
    if (ctx.teamBusy) return;
    ctx.teamBusy = true;
    buttons.forEach(b => { b.disabled = true; });
    try { await fn(); }
    finally {
      ctx.teamBusy = false;
      buttons.forEach(b => { b.disabled = false; });
      if (ctx.teamHost && ctx.teamHost !== host) teamCard(ctx, ctx.teamHost);
    }
  };
  const btn = (style, label, fn, title) => {
    const b = h("button", { style, title, onclick: () => busy(fn) }, label);
    if (ctx.teamBusy) b.disabled = true;
    buttons.push(b);
    return b;
  };
  if (ctx.teamBusy) card.appendChild(h("div", { style: `font-size:12px;color:${C.amber};margin-bottom:6px` },
    "A team change is running — this card updates when it finishes."));
  const mine = teams.find(t => t.leader === me.device_id || t.followers.includes(me.device_id));

  if (mine) {
    const leading = mine.leader === me.device_id;
    const byPadspan = mine.mode === "padspan";
    const incomplete = (mine.incomplete || []).length > 0;
    // A WLED sync team member PadSpan still runs (a team switch it couldn't
    // finish or undo): a break-up would switch its sync back on under
    // PadSpan. It goes back to WLED sync on its own tab first. Read again
    // at the break-up itself: a failed switch can leave one since this card.
    const stuckNow = async () => {
      if (byPadspan) return [];
      try {
        const ex = new Set((((await ctx.hass.callWS({ type: "padspan_ha/wled_exact_list" })) || {}).devices || []).map(d => d.device_id));
        return [mine.leader, ...mine.followers].filter(id => ex.has(id));
      } catch (e) { return []; /* no licence or an older backend: nothing is run by PadSpan */ }
    };
    const stuck = await stuckNow();
    // Run by PadSpan there is no sync group and no leading: every member
    // gets its own look from PadSpan.
    card.appendChild(h("div", { style: "font-size:13px;margin-bottom:6px" }, byPadspan ? [
      h("b", {}, mine.name), ` — run by PadSpan: ${[mine.leader, ...mine.followers].map(nameOf).join(", ")}.`,
    ] : [
      h("b", {}, mine.name), ` — sync group ${mine.group}. `,
      leading ? "This device leads: " : `This device follows ${nameOf(mine.leader)}. `,
      leading ? mine.followers.map(nameOf).join(", ") + " follow it." : "",
    ]));
    // Run this team by: WLED sync (the leader's changes reach the others
    // over the sync group) or PadSpan (every member its own look, at once).
    const runChoice = (mode, label, run) => {
      if ((mode === "padspan") === byPadspan) return h("button", { style: S.btnOn }, label);
      const blocked = !ctx.isAdmin ? "An administrator chooses this" : mode === "padspan" && incomplete ? "Finish or break up the team first" : null;
      if (blocked) return h("button", { style: S.btn + ";opacity:.5;cursor:default", title: blocked }, label);
      return btn(S.btn, label, run);
    };
    // A team switch that failed can leave members PadSpan's (it couldn't
    // put them back): the Atlas and this card are read again.
    const failedSwitch = async () => {
      ctx.onExactChanged();
      await ctx.reload();
    };
    // Back to WLED sync: every member gets its sync from before PadSpan
    // (the backend), then the team's group is set on each, as for a new team.
    const runByWled = async () => {
      if (!confirm(`Run "${mine.name}" by WLED sync again?\n\nEvery member gets back the sync settings it had before PadSpan, `
        + `then the team's sync group ${mine.group} is set up on each device again.`)) return;
      const r = await teamMode(ctx, mine, "mirror");
      if (!r) { await failedSwitch(); return; }
      listHash = r.hash;
      const team = r.team || { ...mine, mode: "mirror" };
      teams = teams.map(t => t === mine ? team : t);
      const members = [team.leader, ...team.followers];
      const read = { gens: {}, hashes: {} };
      let notDone = [];
      try {
        for (const id of members) {
          const [{ hash }, info] = await Promise.all([deviceCfg(ctx, id), deviceInfo(ctx, id)]);
          read.gens[id] = M.wledGen(info);
          read.hashes[id] = hash;
        }
        const { failed, touched } = await applyTeam(ctx, team, devices, card, "join", null, read);
        const done = touched.filter(id => !failed.includes(id));
        notDone = failed.length ? members.filter(id => !done.includes(id)) : [];
      } catch (e) { notDone = members; }
      // Not finished there: a break-up (retry) puts their old settings back.
      if (notDone.length) {
        try { await saveTeams(teams.map(t => t === team ? { ...team, incomplete: notDone } : t)); }
        catch (e) { /* the team stays recorded as it is */ }
      }
      ctx.toast(notDone.length ? `Back on WLED sync, but the team's group couldn't be set on ${notDone.map(nameOf).join(", ")} — see the card`
        : `"${team.name}" is run by WLED sync again`, notDone.length > 0);
      ctx.onExactChanged();
      await ctx.reload();
    };
    const runByPadspan = async () => {
      if (!confirm(`Run "${mine.name}" by PadSpan?\n\n${TEAM_PADSPAN_TEXT} Each is backed up first, and its sync settings `
        + "are put back if the team goes back to WLED sync.")) return;
      const r = await teamMode(ctx, mine, "padspan");
      if (!r) { await failedSwitch(); return; }
      const liveOnly = (r.members || []).filter(m => m.sync_off === "live");
      ctx.toast(`"${mine.name}" is run by PadSpan now`
        + (liveOnly.length ? ` — ${liveOnly.map(m => m.name).join(", ")}: ${liveOnly[0].message}` : ""), liveOnly.length > 0);
      ctx.onExactChanged();
      await ctx.reload();
    };
    card.appendChild(h("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px" }, [
      h("span", { style: `font-size:12px;color:${C.dim}` }, "Run this team by:"),
      runChoice("mirror", "WLED sync", runByWled),
      runChoice("padspan", "PadSpan", runByPadspan),
    ]));
    card.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` }, byPadspan ? TEAM_PADSPAN_TEXT
      : `In Home Assistant, control ${nameOf(mine.leader)}; the others follow it over WLED sync. Vacation Mode switches only the leader.`));
    if (stuck.length) card.appendChild(h("div", { style: `font-size:12px;color:${C.amber};margin-top:6px` },
      `⚠ PadSpan still gives ${stuck.map(nameOf).join(", ")} its instructions (a switch it couldn't finish). `
      + "Give it back to WLED sync on its own Sync & team tab before breaking up the team."));
    if (incomplete) card.appendChild(h("div", { style: `font-size:12px;color:${C.amber};margin-top:6px` },
      `⚠ Not finished on ${mine.incomplete.map(nameOf).join(", ")} — they couldn't be reached or the setup was interrupted. `
      + "A break-up puts their old sync settings back."));
    if (ctx.isAdmin) {
      const row = h("div", { style: "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap" });
      row.appendChild(btn(S.btn + `;color:${C.red}`, incomplete ? "Break up (retry)" : "Break up the team", async () => {
        const held = await stuckNow();
        if (held.length) { ctx.toast(`Give ${held.map(nameOf).join(", ")} back to WLED sync first`, true); return; }
        if (!confirm(`Break up "${mine.name}"? Each device gets back the sync settings it had before the team.`)) return;
        // A team PadSpan runs goes back to WLED sync first (every member's
        // sync from before PadSpan), then breaks up as any team does.
        let team = mine;
        if (byPadspan) {
          const r = await teamMode(ctx, mine, "mirror");
          if (!r) return;
          listHash = r.hash;
          team = r.team || { ...mine, mode: "mirror" };
          teams = teams.map(t => t === mine ? team : t);
          ctx.onExactChanged();
        }
        const { failed } = await applyTeam(ctx, team, devices, card, "leave", team.incomplete && team.incomplete.length ? team.incomplete : null);
        const rest = teams.filter(t => t !== team);
        try {
          // Kept, marked incomplete, while a member couldn't be reset — or the
          // retry would be gone and that device stuck on the team's group.
          await saveTeams(failed.length ? [...rest, { ...team, incomplete: failed }] : rest);
          ctx.toast(failed.length ? "Some devices couldn't be reset — see the card" : "Team removed", failed.length > 0);
          teamCard(ctx, ctx.teamHost || host);
        } catch (e) { ctx.toast("Couldn't update the team list: " + errText(e), true); }
      }));
      row.appendChild(btn(S.btn, "Forget", async () => {
        if (!confirm(`Forget "${mine.name}" without changing any device?\n\n` + (byPadspan
          ? "Their sync stays switched off by PadSpan and each keeps its own look; switch each back to WLED sync on its own Sync & team tab."
          : `Their sync settings stay as they are now, so they keep following sync group ${mine.group}. `
            + "Setting up another team on that group would make them follow it."))) return;
        try { await saveTeams(teams.filter(t => t !== mine)); ctx.toast("Team forgotten"); teamCard(ctx, ctx.teamHost || host); }
        catch (e) { ctx.toast("Couldn't update the team list: " + errText(e), true); }
      }, "Remove the team from PadSpan without touching the devices"));
      card.appendChild(row);
    }
    return;
  }

  card.appendChild(h("div", { style: `font-size:12px;color:${C.dim};margin-bottom:8px` },
    "Make this device the leader and pick the devices that should do what it does. PadSpan gives the team its own WLED sync "
    + "group on each device (backing each up first, and keeping their old sync settings for a break-up), and Home Assistant then only needs this light."));
  if (!ctx.isAdmin) { card.appendChild(h("div", { style: `font-size:12px;color:${C.faint}` }, "An administrator can set up a team.")); return; }
  // A device PadSpan runs has its sync switched off: a WLED sync team would
  // switch it back on under PadSpan. It joins a team by switching back to
  // WLED sync first — the team can then be run by PadSpan.
  let exactIds = new Set();
  try { exactIds = new Set((((await ctx.hass.callWS({ type: "padspan_ha/wled_exact_list" })) || {}).devices || []).map(d => d.device_id)); }
  catch (e) { /* no licence or an older backend: nothing is run by PadSpan */ }
  if (exactIds.has(me.device_id)) {
    card.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` }, "PadSpan gives this light its instructions, so it can't "
      + "lead a WLED sync team. Switch it back to WLED sync above to set one up — the team can then be run by PadSpan."));
    return;
  }
  const taken = new Set(teams.flatMap(t => [t.leader, ...t.followers]));
  const usedGroups = new Set(teams.map(t => t.group));
  // Group 1 is every WLED's factory default — a team never takes it, or
  // every untouched device would follow the leader (round 5).
  const free = GROUPS.filter(g => g !== 1 && !usedGroups.has(g));
  if (!free.length) { card.appendChild(h("div", { style: `font-size:12px;color:${C.amber}` }, "Every sync group is taken by a team.")); return; }
  const draft = { name: `${me.name} team`, group: free[0], followers: new Set() };
  const others = devices.filter(d => d.device_id !== me.device_id);
  const list = h("div", { style: "margin:6px 0" });
  for (const d of others) {
    const inTeam = taken.has(d.device_id), exact = exactIds.has(d.device_id);
    list.appendChild(h("div", { style: "margin:2px 0" + (inTeam || exact ? ";opacity:.5" : "") }, inTeam || exact
      ? h("span", { style: `font-size:12px;color:${C.dim}` }, `${d.name} — ${inTeam ? "already in a team" : "run by PadSpan"}`)
      : check(`${d.name}${d.sw_version ? ` · v${d.sw_version}` : ""}${d.available === false ? " · offline" : ""}`, false,
        v => { if (v) draft.followers.add(d.device_id); else draft.followers.delete(d.device_id); })));
  }
  if (!others.length) list.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` }, "No other WLED devices in Home Assistant."));
  card.appendChild(list);
  const nameIn = document.createElement("input");
  nameIn.value = draft.name; nameIn.style.cssText = S.input + ";width:200px";
  nameIn.addEventListener("change", () => { draft.name = nameIn.value; });
  card.appendChild(h("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, [
    h("span", { style: `font-size:12px;color:${C.dim}` }, "Name"), nameIn,
    h("span", { style: `font-size:12px;color:${C.dim}` }, "Sync group"),
    select(free.map(g => [g, String(g)]), draft.group, v => { draft.group = Number(v); }),
  ]));
  card.appendChild(btn(S.btnPrimary + ";margin-top:8px", "Set up the team", async () => {
    if (!draft.followers.size) { ctx.toast("Pick at least one device to follow this one", true); return; }
    const team = { id: `team-${me.device_id.slice(0, 8)}`, name: draft.name, mode: "mirror", group: draft.group,
      leader: me.device_id, followers: [...draft.followers], prior: {}, incomplete: [] };
    const members = [team.leader, ...team.followers];
    const bit = M.maskOf([team.group]);
    const status = h("div", { style: `font-size:12px;color:${C.dim};margin-top:8px` }, "Checking the devices…");
    card.appendChild(status);
    // 1. Read every member first: each one's sync settings are what a
    //    break-up puts back. Nothing is changed if one can't be read.
    const read = { gens: {}, hashes: {} };
    try {
      for (const id of members) {
        const [{ cfg, hash }, info] = await Promise.all([deviceCfg(ctx, id), deviceInfo(ctx, id)]);
        const sync = (cfg.if && cfg.if.sync) || {};
        team.prior[id] = { send: { ...(sync.send || {}) }, recv: { ...(sync.recv || {}) } };
        read.gens[id] = M.wledGen(info);
        read.hashes[id] = hash;
      }
    } catch (e) { status.remove(); ctx.toast("Nothing was changed — a device couldn't be read: " + errText(e), true); return; }
    // 2. Any other device already following this group would follow the
    //    leader too (a forgotten team, or one set up by hand).
    const listening = [];
    for (const d of others.filter(o => !members.includes(o.device_id) && o.available !== false)) {
      try {
        const { cfg } = await deviceCfg(ctx, d.device_id);
        if (((((cfg.if || {}).sync || {}).recv || {}).grp || 0) & bit) listening.push(d.name);
      } catch (e) { /* offline: can't tell */ }
    }
    status.remove();
    if (!confirm(`Set up "${team.name}" on sync group ${team.group}?\n\n${me.name} will send only on group ${team.group}; `
      + `${team.followers.map(nameOf).join(", ")} will follow only group ${team.group} (they stop following any other group). `
      + "Each device is backed up first, and a break-up puts every device's sync settings back."
      + (listening.length ? `\n\n⚠ ${listening.join(", ")} already follow group ${team.group} and would follow ${me.name} too. `
        + "Cancel and pick another group unless that's what you want." : ""))) return;
    // 3. Recorded before any device changes, as not finished on every
    //    member: a failure, a closed card or a reload leaves a team that a
    //    break-up can undo, never devices changed with nothing recorded.
    try { await saveTeams([...teams, { ...team, incomplete: members }]); }
    catch (e) { ctx.toast("Nothing was changed — the team couldn't be recorded: " + errText(e), true); return; }
    const { failed, touched } = await applyTeam(ctx, team, devices, card, "join", null, read);
    if (!failed.length) {
      try { await saveTeams(teams.map(t => t.id === team.id && t.leader === team.leader ? { ...team, incomplete: [] } : t)); ctx.toast(`"${team.name}" is set up`); }
      catch (e) { ctx.toast("The devices are set, but the team couldn't be marked finished: " + errText(e), true); }
      teamCard(ctx, ctx.teamHost || host);
      return;
    }
    // 4. All or nothing: every device that changed (or may have) goes back.
    const back = touched.length ? (await applyTeam(ctx, team, devices, card, "leave", touched)).failed : [];
    const rest = teams.filter(t => !(t.id === team.id && t.leader === team.leader));
    let listSaved = true;
    try { await saveTeams(back.length ? [...rest, { ...team, incomplete: back }] : rest); }
    catch (e) { listSaved = false; }     // the recorded team stays, not finished everywhere
    ctx.toast(back.length ? `The team wasn't set up, and ${back.map(nameOf).join(", ")} couldn't be put back — see the card`
      : listSaved ? "The team wasn't set up — every device that changed was put back"
        : "The team wasn't set up and every device was put back, but the team list couldn't be updated — press Forget on the card", true);
    if (back.length || !listSaved) teamCard(ctx, ctx.teamHost || host);
  }));
}

/**
 * join: the leader sends ONLY on the team group (and stops receiving it);
 * followers receive ONLY the team group (and stop sending on it) — from
 * the settings read into team.prior, saved through the safe config write
 * and applied live. Stops at the first failure. leave: puts team.prior back
 * (or, for a team recorded before priors existed, just takes the group
 * away), trying every device. `only` limits it to some devices.
 * Returns { failed, touched } — touched: devices whose settings were (or,
 * after a lost reply, may have been) changed.
 */
async function applyTeam(ctx, team, devices, card, mode, only, read = {}) {
  const gens = read.gens || {}, hashes = read.hashes || {};
  const bit = M.maskOf([team.group]);
  const log = h("div", { style: "font-size:12px;margin-top:8px" });
  card.appendChild(log);
  const nameOf = (id) => (devices.find(d => d.device_id === id) || {}).name || id;
  const failed = [], touched = [];
  const members = [[team.leader, "leader"], ...team.followers.map(f => [f, "follower"])]
    .filter(([id]) => !only || only.includes(id));
  for (const [id, role] of members) {
    const line = h("div", {}, `${nameOf(id)} (${role})…`);
    log.appendChild(line);
    let wrote = false;
    try {
      let send, recv;
      if (mode === "join") {
        const prior = team.prior[id];
        const gen15 = (gens[id] || 0) >= 15;
        send = { ...prior.send }; recv = { ...prior.recv };
        if (role === "leader") {
          send = { ...send, grp: bit, dir: true, ...(gen15 ? { en: true } : {}) };
          recv = { ...recv, grp: (recv.grp || 0) & ~bit };
        } else {
          recv = { ...recv, grp: bit, bri: true, col: true, fx: true, ...(gen15 ? { pal: true } : {}) };
          send = { ...send, grp: (send.grp || 0) & ~bit };
        }
      } else {
        const { cfg } = await deviceCfg(ctx, id);
        const sync = (cfg.if && cfg.if.sync) || {};
        send = { ...(sync.send || {}) }; recv = { ...(sync.recv || {}) };
        const prior = team.prior && team.prior[id];
        if (prior) { send = { ...send, ...prior.send }; recv = { ...recv, ...prior.recv }; }
        else { send = { ...send, grp: (send.grp || 0) & ~bit }; recv = { ...recv, grp: (recv.grp || 0) & ~bit }; }
      }
      try { await deviceCfgWrite(ctx, id, { if: { sync: { send, recv } } }, mode === "join" ? hashes[id] : undefined); wrote = true; }
      catch (e) {
        // A lost reply may still have been applied.
        if (e && (e.code === "timeout" || e.code === "unreachable")) wrote = true;
        throw e;
      }
      // …and live, so it works now, not only after a restart.
      await deviceState(ctx, id, { udpn: { send: !!(send.en ?? send.dir), sgrp: send.grp || 0, rgrp: recv.grp || 0 } });
      line.textContent = `✓ ${nameOf(id)} (${role})`;
      line.style.color = C.green;
    } catch (e) {
      failed.push(id);
      line.textContent = `✕ ${nameOf(id)} (${role}): ${errText(e)}`;
      line.style.color = C.red;
    }
    if (wrote) touched.push(id);
    if (mode === "join" && failed.length) break;
  }
  return { failed, touched };
}

// ── What this device sees on the network ──
async function nodesCard(ctx, host) {
  let nodes = [];
  try { nodes = ((await ctx.get("json/nodes")) || {}).nodes || []; } catch (e) { return; }
  if (!nodes.length) return;
  const TYPES = { 82: "ESP8266", 32: "ESP32", 33: "ESP32-S2", 34: "ESP32-S3", 35: "ESP32-C3", 37: "ESP32-C2", 38: "ESP32-H2" };
  host.appendChild(h("div", { style: S.card }, [
    h("div", { style: "font-weight:700;margin-bottom:6px" }, "Other WLED devices this one sees"),
    ...nodes.map(n => h("div", { style: `font-size:12px;display:flex;gap:10px` }, [
      h("span", { style: "width:180px" }, n.name || "?"), h("span", { style: `color:${C.dim}` }, n.ip || ""),
      h("span", { style: `color:${C.faint}` }, TYPES[n.type] || ""), h("span", { style: `color:${C.faint}` }, n.vid ? `build ${n.vid}` : ""),
    ])),
  ]));
}
