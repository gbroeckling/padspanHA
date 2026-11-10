// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Rooms from plans (Build from plans, Stage 2, experimental): the Plans
// tool's third tab in views/live_aboard_plans.js, RUN: the tab shows only
// with the line-up on, a floor not lined up says so and points to Line up
// plans, the picker and its estimate, a session's rooms (ready, look closely,
// far from yours, the spot pick), both reads shown, read 1 or 2 picked, the
// flat map with a tap selecting, Merge selected (two of the person's rooms
// refused), an extra space merged into a room or added as a new room with a
// name the person picks, doors and windows with maybes unticked, the stairs,
// the gate line, Accept all sending every tick in one save, a refusal said
// in its words, Undo, and every part saying experimental. A synthetic
// session; no house's data. The pytest wrapper is tests/test_plan_build_rooms.py.
//
// Run:  node tests/js/plan_build_rooms.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
globalThis.Image = class { constructor() { this.complete = false; this.naturalWidth = 0; } addEventListener() {} set src(v) { this._src = v; } get src() { return this._src; } };
const { createPlans } = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/live_aboard_plans.js").href);
const DRAFT = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/live_aboard_draft.js").href);

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };
const all = (n, out = []) => { for (const c of (n.childNodes || n.children || [])) { out.push(c); all(c, out); } return out; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const tag = (n) => (n.tagName || n.localName || "").toUpperCase();
const buttons = (sheet) => all(sheet).filter(n => tag(n) === "BUTTON");
const button = (sheet, label) => buttons(sheet).find(b => text(b) === label || text(b).startsWith(label)) || null;
const click = async (b) => { if (!b) return false; b.dispatchEvent(new Event("click", { bubbles: true })); await settle(); return true; };
const attr = (n, k) => (n.getAttribute ? n.getAttribute(k) : (n.attributes || {})[k]);
/** The button `label` on the row whose text starts with `row`. */
const rowButton = (sheet, row, label) => { const r = all(sheet).find(n => tag(n) === "LABEL" && text(n).startsWith(row)); return r ? buttons(r).find(b => text(b) === label) || null : null; };
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

const PROPOSAL = () => ({
  rooms: {
    Den: { id: "room:Den", room: "Den", now_m: box(1, 1, 4, 4.5), reads_m: [box(1, 1, 4, 4.5), box(1, 1, 4, 4.5)], parts: [["DEN"], ["DEN"]], agree: 0.98, ready: true, pick: 1,
      picked_by: "spots", spots: [2, 2, 2], outline_m: box(1, 1, 4, 4.5), merged: [], flags: [], iou_now: 0.99, area_now: 10.5, area_new: 10.5, cal: { labelled: 2, leave: [], leaving: 0 }, default: true },
    Shop: { id: "room:Shop", room: "Shop", now_m: box(4.2, 1, 9, 4.5), reads_m: [box(4.2, 1, 9, 4.5), box(4.2, 1, 9, 3)], parts: [["SHOP"], ["SHOP"]], agree: 0.57, ready: false, pick: 1,
      picked_by: "spots", spots: [1, 0, 1], outline_m: box(4.2, 1, 9, 4.5), merged: [], flags: ["reads_differ"], iou_now: 1.0, area_now: 16.8, area_new: 16.8, cal: { labelled: 1, leave: [], leaving: 0 }, default: false },
    Kitchen: { id: "room:Kitchen", room: "Kitchen", now_m: box(9.2, 1, 12, 3), reads_m: [box(9.2, 1, 12, 4.5), box(9.2, 1, 12, 4.5)], parts: [["KITCHEN"], ["KITCHEN"]], agree: 0.99, ready: true, pick: 1,
      picked_by: "spots", spots: [4, 4, 4], outline_m: box(9.2, 1, 12, 4.5), merged: [], flags: [], iou_now: 0.57, area_now: 5.6, area_new: 9.8, cal: { labelled: 4, leave: ["cp_9"], leaving: 1 }, default: true },
  },
  unseen: ["Garage"],
  spaces: {
    "space:1": { id: "space:1", name: "STORE", outline_m: box(1, 4.7, 2.5, 7), reads: [1, 2], merged_into: null, new: null, parts: ["space:1"] },
    "space:2": { id: "space:2", name: "NOOK", outline_m: box(2.6, 4.7, 4, 7), reads: [2], merged_into: null, new: null, parts: ["space:2"] },
  },
  openings: {
    "door:1": { id: "door:1", kind: "door", type: null, cls: "door", reads: 2, floor_id: "main", between: ["DEN", "SHOP"], placed: true, a_m: [4.1, 2.6], b_m: [4.1, 3.4], rooms: ["Den", "Shop"], existing: null, default: true },
    "door:2": { id: "door:2", kind: "doorway", type: null, cls: "door", reads: 1, floor_id: "main", between: ["STORE", "NOOK"], placed: true, a_m: [2.55, 5.4], b_m: [2.55, 6.3], rooms: ["STORE", "NOOK"], existing: null, default: false },
    "door:3": { id: "door:3", kind: "door", type: "sliding", cls: "door", reads: 2, floor_id: "main", between: ["SHOP", "outside"], placed: true, a_m: [5.6, 4.5], b_m: [6.4, 4.5], rooms: ["Shop"], existing: { id: "door_00000001", what: "opening", entry: { kind: "door", floor_id: "main", a_m: [5.5, 4.5], b_m: [6.3, 4.5], head_m: 2.03, hinge: "left", swing: "in" } }, relation: "correction", default: false },
    "window:1": { id: "window:1", kind: "window", type: null, cls: "window", reads: 2, floor_id: "main", between: ["DEN"], placed: true, a_m: [1, 1.9], b_m: [1, 3.1], rooms: ["Den"], existing: null, default: true },
  },
  stairs: { "stairs:1": { id: "stairs:1", floor_id: "main", geom: { x_m: 1.9, y_m: 2.25, rotation: 0, width_m: 0.8, depth_m: 1.5, shape: "straight", says: "UP" }, room: "DEN", reads: 2, relation: "new", default: true } },
  labelled: 7,
});
const SESSION = (over = {}) => ({ id: "rb_1", rev: 3, stage: "s2", floor_id: "main", status: "done", error: null, reads: 2, est_usd: 0.04, spent_s: 20, budget_s: 600,
  plans: [{ map_id: "g1", name: "Measured", read: [true, true] }], stops: [], resumable: false, edits: { merges: [], spaces: {}, picks: {} }, saved: {}, proposal: PROPOSAL(), ...over });
const INFO = (over = {}) => ({ unlock: { ok: true, why: "ok", display: "Claude Opus 5.5" }, master: true, switch: true, on: true, running: null, start_blocked: null,
  floors: [{ id: "basement", name: "Basement", plans: [], last: null }, { id: "main", name: "Main", plans: [], last: null }, { id: "upper", name: "Upper", plans: [], last: null }],
  rooms: { basement: { ready: true, why: "ok", note: "lineup_open", lined_up: false, plans: [{ map_id: "b1", name: "Old scan", est_usd: 0.03, lineup: "not_lined_up", tick: true },
                                                                                       { map_id: "b2", name: "Upstairs scan", est_usd: 0.03, lineup: "other_floor", tick: false }], others: [], last: null },
           main: { ready: true, why: "ok", note: null, lined_up: true, plans: [{ map_id: "g1", name: "Measured", est_usd: 0.035, lineup: "lined_up", tick: true }], others: [], last: null },
           upper: { ready: false, why: "not_placed", note: "no_lineup", lined_up: false, plans: [], others: [], last: null } },
  stall: { month: {}, words: {} }, ...over });
const GATE = (over = {}) => ({ how: "containment", now: 96.9, with: 96.3, spots: 324, inside_now: 314, inside_with: 312, blocked: false, scored: true, held_out: { now: 6, with: 4, spots: 47 }, ...over });

function mount(answers, opts = {}){
  const sheet = document.createElement("div"), root = document.createElement("div");
  const calls = [], hints = [];
  const callWS = async (m) => {
    calls.push(m);
    const a = answers[m.type.replace("padspan_ha/", "")];
    const v = typeof a === "function" ? a(m) : a;
    if (v instanceof Error) throw v;
    return v;
  };
  let tool;
  const redraw = () => { sheet.replaceChildren(); tool.sheet(); };
  const draft = DRAFT.createDraft(DRAFT.ownedOf({ schema: 1, pieces: {} }));
  tool = createPlans({ root, sheet, guard: (f) => f, host: () => ({ callWS }), floors: () => [{ fl: { id: "main", name: "Main" } }], hint: (t, bad) => hints.push([t, bad]), redraw,
    DRAFT, draft: () => draft, change: (fn) => draft.change(fn), saving: () => false, save: () => {},
    stairPiece: opts.noStairs ? undefined : (g, fid, label) => ({ id: "fur_0000aaaa", recipe: { kind: "stairs", params: { shape: g.shape } }, floor_id: fid, x_m: g.x_m, y_m: g.y_m, label }),
    fileWritten: () => {} });
  return { sheet, tool, calls, hints, sent: (type) => calls.filter(c => c.type === `padspan_ha/${type}`) };
}
const BASE = { maps_image_urls: { image_urls: { g1: "/signed/g1" } },
  plan_ai_plans: { plans: [], ai: { ready: true, name: "Claude", local: false }, running: null, latest: null, start_blocked: null } };

// ── no line-up on: no rooms tab ──────────────────────────────────────────────
{
  const M = mount({ ...BASE, plan_build_info: { ...INFO(), on: false } });
  M.tool.show(true); await settle();
  check("off: no rooms tab when the line-up is off", !button(M.sheet, "Rooms from plans (experimental)"), text(M.sheet));
  M.tool.dispose();
}
// ── the picker: lined up, not lined up, the estimate, Start ─────────────────
{
  const M = mount({ ...BASE, plan_build_info: INFO(), plan_build_rooms_start: { session: "rb_2" },
    plan_build_rooms_status: { session: SESSION({ id: "rb_2", status: "running", proposal: null, progress: { plan: 1, of: 1, name: "Measured", step: "read 2" } }), areas: [] } });
  M.tool.show(true); await settle();
  const tab = button(M.sheet, "Rooms from plans (experimental)");
  check("tab: offered beside the other two", !!tab && !!button(M.sheet, "Line up plans (experimental)") && !!button(M.sheet, "Add data via plans"), buttons(M.sheet).map(b => text(b)));
  await click(tab);
  const t = () => text(M.sheet);
  check("picker: each floor, lined up or not; only a floor with no plan placed can't be read", !!button(M.sheet, "Main · 1 plan lined up") && !!button(M.sheet, "Basement · 2 plans")
    && !!button(M.sheet, "Upper · no plan placed"), buttons(M.sheet).map(b => text(b)));
  await click(button(M.sheet, "Upper · no plan placed"));
  check("picker: no plan placed: said, nothing to start", t().includes("no plan is placed on this floor yet, so there is nothing to read.") && !button(M.sheet, "Read rooms on Upper (experimental)"), t());
  await click(button(M.sheet, "Basement · 2 plans"));
  check("picker: an unfinished line-up is a note with the way to finish it, not a block (Garry, 2026-11-10)",
    t().includes("Line-up not finished on this floor: outlines follow your plans as placed now. Finish the line-up for a closer fit.") && !!button(M.sheet, "Finish the line-up (experimental)")
    && !!button(M.sheet, "Read rooms on Basement (experimental)"), t());
  check("picker: each plan says what the line-up says of it; one showing another floor is unticked", t().includes("Old scan — not lined up: read where it sits now")
    && t().includes("Upstairs scan — the line-up says it shows another floor: not ticked"), t());
  await click(button(M.sheet, "Main · 1 plan lined up"));
  check("picker: a lined-up plan says so, no note", t().includes("Measured — lined up") && !t().includes("Line-up not finished"), t());
  check("picker: two reads a plan, the estimate, nothing saved before accepting", t().includes("Claude Opus 5.5 reads them, twice each") && t().includes("about $0.04 for this plan (estimate, experimental)")
    && t().includes("Nothing is saved until you accept: one save for the floor, a backup first, one undo."), t());
  await click(button(M.sheet, "Basement · 2 plans"));
  await click(button(M.sheet, "Read rooms on Basement (experimental)"));
  const st = M.sent("plan_build_rooms_start")[0];
  check("start: the plans ticked, the other floor's left out", st && st.floor_id === "basement" && st.map_ids.join() === "b1", JSON.stringify(st));
  check("progress: which read, and Stop", t().includes("Reading Measured, read 2 (1 of 1)… experimental.") && !!button(M.sheet, "Stop (experimental)"), t());   // the status answer's
  M.tool.dispose();
}
// ── a session: the rooms, the map, merges, the gate, Accept all, Undo ───────
{
  let sess = SESSION(), gate = GATE();
  const edits = [];
  const M = mount({ ...BASE, plan_build_info: INFO({ rooms: { ...INFO().rooms, main: { ...INFO().rooms.main, last: { session: "rb_1", at: 5, status: "done" } } } }),
    plan_build_rooms_status: () => ({ session: sess, areas: ["Storage", "Mudroom"], undo: null }),
    plan_build_rooms_check: () => ({ gate }),
    plan_build_rooms_edit: (m) => {
      edits.push(m);
      if (m.op === "merge" && m.parts.filter(p => p.startsWith("room:")).length > 1) return new Error("Rooms from plans (experimental): two of your rooms can't be merged here: that would remove one.");
      sess = JSON.parse(JSON.stringify(sess)); sess.rev++;
      if (m.op === "merge" && m.parts[0] === "room:Den") { sess.proposal.spaces["space:1"].merged_into = "room:Den"; sess.proposal.rooms.Den.merged = ["space:1"]; sess.edits.merges.push({ id: 1, into: "room:Den", parts: ["space:1"] }); }
      if (m.op === "space") sess.proposal.spaces[m.space].new = m.name || null;
      if (m.op === "pick") { sess.proposal.rooms[m.room].pick = m.read; sess.proposal.rooms[m.room].picked_by = "person"; }
      if (m.op === "separate") { sess.proposal.spaces["space:1"].merged_into = null; sess.proposal.rooms.Den.merged = []; sess.edits.merges = []; }
      return { session: sess, areas: ["Storage", "Mudroom"] };
    },
    plan_build_rooms_read_again: (m) => {
      sess = JSON.parse(JSON.stringify(sess)); sess.rev++;
      const r = sess.proposal.rooms[m.room]; r.ready = true; r.picked_by = "two_of_three"; r.third = { agree: [0.93, 0.55], decided: true }; r.flags = []; r.reads_m.push(r.reads_m[0]);
      return { session: sess, areas: ["Storage", "Mudroom"] };
    },
    plan_build_rooms_commit: (m) => {
      if (!commits.refused) { commits.refused = true; sess = { ...sess, rev: sess.rev + 1, stops: [{ reason: "rooms_changed", say: "A room, a door or a stair was changed in your house since Claude read the plans, so nothing was saved.", next: "Read the floor again." }] };
        return { ok: false, code: "changed_since", changed: ["room:Shop"], message: "Rooms from plans (experimental): A room, a door or a stair was changed in your house since Claude read the plans, so nothing was saved. Read the floor again.",
                 rev: sess.rev, session: sess }; }
      sess = { ...sess, rev: sess.rev + 1, saved: Object.fromEntries(m.items.map(i => [i, "rb_b1"])), stops: [] };
      return { ok: true, batch: "rb_b1", backup_id: "bk_1", saved: m.items, session: sess, undo: { session: "rb_1", items: m.items.length } };
    },
    plan_build_rooms_undo: () => { sess = { ...sess, rev: sess.rev + 1, saved: {} }; return { ok: true, undone: 7, skipped: [{ item_id: "room:Den", why: "changed" }], session: sess }; } });
  const commits = {};
  M.tool.show(true); await settle();
  await click(button(M.sheet, "Rooms from plans (experimental)"));
  const t = () => text(M.sheet);
  check("session: opens on the floor's last session, in numbers", M.sent("plan_build_rooms_status")[0]?.session === "rb_1"
    && t().includes("Main: done. 2 reads, about $0.04 (estimate). 3 rooms (2 ready, 1 to look at), 2 extra spaces, 3 doors, 1 windows, 1 stair."), t());
  check("banner: what it may get wrong", t().includes("Claude reads each plan twice; where the two reads agree, that outline is proposed even if yours differs. Where they differ, look closely."), t());
  check("rooms: ready, the reads differing; agreeing reads trusted over the outline drawn (Garry, 2026-11-10)", t().includes("Both reads agree (0.98).") && t().includes("Look closely: the two reads differ (0.57).")
    && t().includes("Both reads agree (0.99).Overlap with your outline 0.57; 5.6 → 9.8 m².") && !t().includes("Far from your outline"), t());
  check("rooms: the spot pick and the spots that would leave, never relabelled, and the choice", t().includes("Using read 1: it keeps 1 of 1 calibration spots inside it.")
    && t().includes("1 of your 4 spots would fall outside it; it keeps its room label. Your choice: keep yours, or use Claude's.") && !!button(M.sheet, "Keep mine") && !!button(M.sheet, "Use Claude's"), t());
  check("rooms: the ones the plans don't show, left", t().includes("Not on these plans, left as they are: Garage."), t());
  check("map: a flat floor map with its key", all(M.sheet).some(n => tag(n) === "CANVAS" && attr(n, "data-plan-build") === "rooms-map") && t().includes("Tap a room or a space to select it."), t());
  check("score: the floor's spots for information, never a refusal", t().includes("For information: calibration spots inside their room, 96.9 % now, 96.3 % with what is ticked (324 spots). Each room below says its own.")
    && t().includes("Held-out check: 6 % now, 4 % with these.") && !t().includes("refused"), t());
  const ck = M.sent("plan_build_rooms_check")[0];
  check("gate: asked for the ticked rooms", ck && ck.items.join() === "room:Den,room:Kitchen", JSON.stringify(ck));
  check("openings: counts, maybes and the one already there, a correction", t().includes("Proposed when both reads found it: 2 doors, 1 windows. Found by one read only (\"maybe\", not ticked): 1. Already in your house, offered as a correction (not ticked): 1.")
    && t().includes("Already in your house: a correction moves or resizes yours to the one read. Not ticked."), t());
  const ticks = () => M.tool.state().rooms.ticks;
  check("ticks: rooms the reads agree on, both-read doors and windows, the stair; not the room whose reads differ, not the maybe, not the existing one",
    ticks().join() === "door:1,room:Den,room:Kitchen,stairs:1,window:1", ticks());
  check("ticks: the room whose reads differ says it isn't ticked (Garry, by form, 2026-11-10)", t().includes("Look closely: the two reads differ (0.57). Not ticked: show both reads to compare, read it again, or tick it to use it."), t());
  // Keep mine / Use Claude's on a room whose spots would leave it.
  await click(button(M.sheet, "Keep mine"));
  check("choice: keep mine unticks the room", !ticks().includes("room:Kitchen"), ticks());
  await click(button(M.sheet, "Use Claude's"));
  check("choice: use Claude's ticks it again", ticks().includes("room:Kitchen"), ticks());
  // Read again on the flagged room: a third read, two of three decide.
  await click(button(M.sheet, "Read again (experimental)"));
  const ra = M.sent("plan_build_rooms_read_again")[0];
  check("read again: sent for the flagged room with the rev", ra && ra.room === "Shop" && ra.rev === 3, JSON.stringify(ra));
  check("read again: two of three said, the third read offered", t().includes("Read again: two of three reads agree (0.93).") && !!button(M.sheet, "Use read 3"), t());
  // Both reads, and the other read picked.
  await click(button(M.sheet, "Show both reads"));
  check("both reads: shown on the map", M.tool.state().rooms && t().includes("Hide both reads"), t());
  await click(rowButton(M.sheet, "Shop", "Use read 2"));
  const pk = edits.find(e => e.op === "pick");
  check("pick: read 2 for the room, sent with the rev", pk && pk.room === "Shop" && pk.read === 2 && pk.rev === 4, JSON.stringify(pk));
  check("pick: said", t().includes("Using read 2 (your pick)"), t());
  // Merge on the map: two of his rooms refused; a space into a room.
  M.tool.roomsSelect("room:Den"); M.tool.roomsSelect("room:Shop"); await settle();
  check("merge: two of his rooms can't be merged", t().includes("Two of your rooms can't be merged here: that would remove one.") && button(M.sheet, "Merge selected into one (experimental)").disabled, t());
  M.tool.roomsSelect("room:Shop"); M.tool.roomsSelect("space:1"); await settle();
  check("merge: the selection named", t().includes("Selected: Den, STORE."), t());
  await click(button(M.sheet, "Merge selected into one (experimental)"));
  const mg = edits.find(e => e.op === "merge");
  check("merge: sent as one edit, the selection cleared", mg && mg.parts.join() === "room:Den,space:1" && M.tool.state().rooms.selected.length === 0, JSON.stringify(mg));
  check("merge: said on the room, Separate offered", t().includes("Merged in: STORE.") && !!button(M.sheet, "Separate (experimental)"), t());
  // An extra space added as a new room, its name picked by the person.
  await click(button(M.sheet, "Add as a new room (experimental)"));
  check("new room: the Home Assistant areas are offered", t().includes("Home Assistant areas…") && t().includes("Mudroom"), t());
  const inp = all(M.sheet).find(n => tag(n) === "INPUT" && n.placeholder === "room name");
  inp.value = "Mudroom";
  await click(button(M.sheet, "Use it"));
  const nm = edits.find(e => e.op === "space");
  check("new room: the name sent, the space ticked", nm && nm.space === "space:2" && nm.name === "Mudroom" && ticks().includes("space:2") && t().includes("NOOK → Mudroom"), JSON.stringify(nm));
  // Accept all: every tick in one save; a data-safety refusal (changed since) is said, and Save stays offered.
  const accept = () => button(M.sheet, "Accept all for Main (experimental)");
  check("accept all: names what it saves", !!accept() && text(accept()).includes("2 rooms, 1 new, 1 doors, 1 windows, 1 stairs"), buttons(M.sheet).map(b => text(b)));
  await click(accept());
  const c1 = M.sent("plan_build_rooms_commit")[0];
  check("accept all: one save with every tick and the new stair's piece", c1 && c1.items.length === 6 && !c1.items.includes("room:Shop") && c1.finals["stairs:1"] && c1.finals["stairs:1"].x_m === 1.9 && c1.rev === sess.rev - 1, JSON.stringify(c1));
  check("accept all: a change since the read is said in its words; Save is never held back by the score", t().includes("Rooms from plans (experimental): A room, a door or a stair was changed in your house since Claude read the plans")
    && !accept().disabled, t());
  M.tool.roomsBoth(null); await settle();
  const parts = all(M.sheet).filter(n => attr(n, "data-plan-build") !== undefined && attr(n, "data-plan-build") !== null && attr(n, "data-plan-build") !== "rooms-map");
  const quiet = parts.filter(n => !/experimental/i.test(text(n)));
  check("experimental: every part of the tab says so", parts.length >= 5 && quiet.length === 0, [parts.length, quiet.map(n => text(n).slice(0, 90))]);
  // A tick changed: the score is asked again; then saved.
  const kb = all(M.sheet).find(n => tag(n) === "INPUT" && n.type === "checkbox" && n.parentNode && text(n.parentNode).startsWith("Kitchen"));
  kb.checked = false; kb.dispatchEvent(new Event("change")); await settle();
  check("untick: the gate is asked again", M.sent("plan_build_rooms_check").length >= 2, M.sent("plan_build_rooms_check").length);
  await click(accept());
  check("accept all: saved, said once, the items marked", M.sent("plan_build_rooms_commit").length === 2 && M.hints.some(([h]) => h.startsWith("Rooms from plans (experimental): saved 5 items in one save."))
    && t().includes("Den · saved"), [M.hints, M.sent("plan_build_rooms_commit").map(c => c.items)]);
  // Undo: asked first, then the whole session.
  await click(button(M.sheet, "Undo this rooms session (experimental)"));
  check("undo: asked first, saying what it does", t().includes("Put every room, door, window and stair this session saved back as it was?") && !M.sent("plan_build_rooms_undo").length, t());
  await click(button(M.sheet, "Undo it (experimental)"));
  check("undo: sent, and what was left is said", M.sent("plan_build_rooms_undo")[0]?.session === "rb_1" && M.hints.some(([h]) => h === "Rooms from plans (experimental): 7 put back; 1 changed since was left as it is."), M.hints);
  check("hints: every one says experimental", M.hints.every(([h]) => h.startsWith("Rooms from plans (experimental): ")), M.hints);
  M.tool.dispose();
}
// ── no 3D view's builders: a new stair can't be saved from here, and says so ──
{
  const M = mount({ ...BASE, plan_build_info: INFO({ rooms: { ...INFO().rooms, main: { ...INFO().rooms.main, last: { session: "rb_1", at: 5, status: "done" } } } }),
    plan_build_rooms_status: { session: SESSION(), areas: [] }, plan_build_rooms_check: { gate: GATE({ scored: false, spots: 3, inside_now: 3, inside_with: 2, held_out: null }) } }, { noStairs: true });
  M.tool.show(true); await settle();
  await click(button(M.sheet, "Rooms from plans (experimental)"));
  const t = text(M.sheet);
  check("no builders: the stair says to open Live Aboard, unticked", t.includes("A new stair is built in the 3D view: open Live Aboard to save it."), t);
  check("few spots: shown, not judged", t.includes("Only 3 calibration spots on this floor: too few to judge (3 inside their room now, 2 with these). Experimental."), t);
  M.tool.dispose();
}
console.log(JSON.stringify(results));
process.exit(0);
