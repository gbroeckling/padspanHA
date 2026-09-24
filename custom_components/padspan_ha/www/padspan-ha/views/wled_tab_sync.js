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
 */

const _q = new URL(import.meta.url).search;
const M = await import(`./wled_model.js${_q}`);
const { C, S, h, check, select, numberBox, errText, reportCfg } = await import(`./wled_ui.js${_q}`);

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

export function syncView(ctx) {
  const root = h("div");
  root.appendChild(liveSyncCard(ctx));
  const saved = h("div");
  root.appendChild(saved);
  const team = h("div");
  root.appendChild(team);
  const nodes = h("div");
  root.appendChild(nodes);
  savedSyncCard(ctx, saved);
  teamCard(ctx, team);
  nodesCard(ctx, nodes);
  return root;
}

// ── Live sync (state.udpn) ──
// "Send my changes" is anyone's (live, unsaved); the group numbers are an
// administrator's — the next settings save would make them permanent
// (round 5). Non-admins see the groups, can't change them.
function liveSyncCard(ctx) {
  const u = ctx.state.udpn || {};
  const card = h("div", { style: S.card });
  card.appendChild(h("div", { style: "font-weight:700;margin-bottom:6px" }, "Sync — right now"));
  const write = (patch) => ctx.write({ udpn: patch }, "change sync");
  card.appendChild(h("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0" }, [
    check("Send my changes", u.send, v => write({ send: v }), "Other WLED devices listening to these groups follow this one"),
    h("span", { style: `font-size:12px;color:${C.dim}` }, "to groups"),
    groupChips(u.sgrp, v => write({ send: !!u.send, sgrp: v, rgrp: u.rgrp || 0 }), !ctx.isAdmin),
  ]));
  card.appendChild(h("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0" }, [
    h("span", { style: `font-size:12px;color:${C.dim};margin-right:8px` }, "Follow changes from groups"),
    groupChips(u.rgrp, v => write({ send: !!u.send, sgrp: u.sgrp || 0, rgrp: v }), !ctx.isAdmin),
  ]));
  card.appendChild(h("div", { style: `font-size:11px;color:${C.faint};margin-top:4px` },
    "These act now, until the device restarts. A settings save can make them permanent."
    + (ctx.isAdmin ? "" : " An administrator changes the groups.")));
  return card;
}

// ── Saved sync settings (cfg if.sync) ──
async function savedSyncCard(ctx, host) {
  host.innerHTML = "";
  const card = h("div", { style: S.card });
  host.appendChild(card);
  card.appendChild(h("div", { style: "font-weight:700;margin-bottom:6px" }, "Sync — saved for the next boot"));
  let cfg, hash;
  try { ({ data: cfg, hash } = await ctx.call("padspan_ha/wled_get", { path: "json/cfg" })); }
  catch (e) { card.appendChild(h("div", { style: `color:${C.red};font-size:12px` }, "Couldn't read the settings: " + errText(e))); return; }
  const sync = JSON.parse(JSON.stringify((cfg.if && cfg.if.sync) || {}));
  const recv = sync.recv || (sync.recv = {}), send = sync.send || (sync.send = {});
  const ro = !ctx.isAdmin;
  const opt = (obj, key, label, title) => key in obj ? check(label, obj[key], v => { obj[key] = v; }, title) : null;
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
  if ("ret" in send) card.appendChild(h("div", { style: "display:flex;gap:6px;align-items:center;margin-top:6px" },
    [h("span", { style: `font-size:12px;color:${C.dim}` }, "Retries"), numberBox(send.ret, v => { send.ret = v; }, { max: 30 })]));
  card.appendChild(h("div", { style: `font-size:11px;color:${C.faint};margin-top:6px` },
    `Sync port ${sync.port0 ?? 21324}${sync.port1 !== undefined ? ` · ${sync.port1}` : ""} — ports are changed on the device's own Sync page (they need a restart).`));
  if (ctx.isAdmin) card.appendChild(h("button", { style: S.btnPrimary + ";margin-top:8px", onclick: async () => {
    try {
      const r = await ctx.call("padspan_ha/wled_cfg", { patch: { if: { sync: { send, recv } } }, base_hash: hash });
      reportCfg(ctx, r, "Sync settings saved");
      savedSyncCard(ctx, host);
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
    card.appendChild(h("div", { style: "font-size:13px;margin-bottom:6px" }, [
      h("b", {}, mine.name), ` — sync group ${mine.group}. `,
      leading ? "This device leads: " : `This device follows ${nameOf(mine.leader)}. `,
      leading ? mine.followers.map(nameOf).join(", ") + " follow it." : "",
    ]));
    card.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` },
      `In Home Assistant, control ${nameOf(mine.leader)}; the others follow it over WLED sync. Vacation Mode switches only the leader.`));
    if ((mine.incomplete || []).length) card.appendChild(h("div", { style: `font-size:12px;color:${C.amber};margin-top:6px` },
      `⚠ Not finished on ${mine.incomplete.map(nameOf).join(", ")} — they couldn't be reached or the setup was interrupted. `
      + "A break-up puts their old sync settings back."));
    if (ctx.isAdmin) {
      const row = h("div", { style: "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap" });
      row.appendChild(btn(S.btn + `;color:${C.red}`, (mine.incomplete || []).length ? "Break up (retry)" : "Break up the team", async () => {
        if (!confirm(`Break up "${mine.name}"? Each device gets back the sync settings it had before the team.`)) return;
        const { failed } = await applyTeam(ctx, mine, devices, card, "leave", mine.incomplete && mine.incomplete.length ? mine.incomplete : null);
        const rest = teams.filter(t => t !== mine);
        try {
          // Kept, marked incomplete, while a member couldn't be reset — or the
          // retry would be gone and that device stuck on the team's group.
          await saveTeams(failed.length ? [...rest, { ...mine, incomplete: failed }] : rest);
          ctx.toast(failed.length ? "Some devices couldn't be reset — see the card" : "Team removed", failed.length > 0);
          teamCard(ctx, ctx.teamHost || host);
        } catch (e) { ctx.toast("Couldn't update the team list: " + errText(e), true); }
      }));
      row.appendChild(btn(S.btn, "Forget", async () => {
        if (!confirm(`Forget "${mine.name}" without changing any device?\n\nTheir sync settings stay as they are now, so they `
          + `keep following sync group ${mine.group}. Setting up another team on that group would make them follow it.`)) return;
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
    const inTeam = taken.has(d.device_id);
    list.appendChild(h("div", { style: "margin:2px 0" + (inTeam ? ";opacity:.5" : "") }, inTeam
      ? h("span", { style: `font-size:12px;color:${C.dim}` }, `${d.name} — already in a team`)
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
