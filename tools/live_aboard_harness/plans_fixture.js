// The Plans tool's fake server for the harness (index.html?edit=1&plans=1): the
// plan_ai_ commands over a fictional session on the fixture house, and plan
// pictures drawn here on a canvas from its rooms. Nothing here is a real plan.
//
// plansFixture(MODEL, FILE) answers {settings, callWS, calls, session}; FILE is the
// 3D file the page loads: the two stairs "already in the house" go in it.

const rectOf = (g) => {
  const xs = g.points_m.map(p => p[0]), ys = g.points_m.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const CORNERS = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const EXT = [-1, -1, 12, 11];        // every plan covers this, in metres

/** A plan on paper: rooms as walls, stair treads where `stairs` says, a title block. */
function drawPlan(MODEL, floor, title, stairs, nudge = 0, marks = []){
  const c = document.createElement("canvas"), k = 96, [x0, y0, x1, y1] = EXT;
  c.width = (x1 - x0) * k; c.height = (y1 - y0) * k;
  const g = c.getContext("2d");
  g.fillStyle = "#f7f4ea"; g.fillRect(0, 0, c.width, c.height);
  const px = (x) => (x - x0 + nudge) * k, py = (y) => (y - y0) * k;
  g.strokeStyle = "#14181c"; g.lineWidth = 7; g.fillStyle = "#14181c"; g.font = "600 34px sans-serif"; g.textAlign = "center";
  for (const [name, geo] of Object.entries(MODEL.room_geometry_m)) {
    if (geo.floor_id !== floor) continue;
    const [a, b, d, e] = rectOf(geo);
    g.strokeRect(px(a), py(b), (d - a) * k, (e - b) * k);
    g.fillText(name.toUpperCase(), px((a + d) / 2), py((b + e) / 2));
  }
  g.lineWidth = 3;
  for (const [cx, cy, w, h] of stairs) {
    const left = px(cx - w / 2), top = py(cy - h / 2);
    g.strokeRect(left, top, w * k, h * k);
    const along = h >= w, n = 9;
    for (let i = 1; i < n; i++) {
      g.beginPath();
      if (along) { g.moveTo(left, top + h * k * i / n); g.lineTo(left + w * k, top + h * k * i / n); }
      else { g.moveTo(left + w * k * i / n, top); g.lineTo(left + w * k * i / n, top + h * k); }
      g.stroke();
    }
  }
  g.lineWidth = 3;
  for (const [x, y] of marks) { g.beginPath(); g.arc(px(x), py(y), 12, 0, Math.PI * 2); g.stroke(); }
  g.font = "500 30px sans-serif"; g.textAlign = "left";
  g.fillText(`${title}  ·  SCALE 1:100`, 30, c.height - 26);
  return c.toDataURL("image/png");
}

const stairAt = (id, label, x, y, rotation = 0, width = 1.1, depth = 3.2) => ({ id, label, floor_id: "main", x_m: x, y_m: y, z_m: 0, rotation, origin: "build", library_id: null, submission_id: null, entity_id: null, entity_reg_id: null,
  recipe: { kind: "stairs", params: { shape: "straight", style: "closed", rail: "none", to_floor: "upper" }, colors: [], width_m: width, depth_m: depth, height_m: 2.8 } });

export function plansFixture(MODEL, FILE, lightsOnly = false){
  FILE.pieces = { ...(FILE.pieces || {}),
    fur_0000bb01: stairAt("fur_0000bb01", "Den stairs", 1.2, 8.1),
    fur_0000bb02: stairAt("fur_0000bb02", "Stairs (from the plan)", 9.6, 8.1) };
  const IMG = {
    pm1: drawPlan(MODEL, "main", "MAIN FLOOR PLAN", [[2.6, 8.1, 1.1, 3.2], [2.5, 5.05, 3.2, 1.1], [9.6, 8.1, 1.1, 3.2], [8.0, 3.0, 1.1, 3.2]]),
    pm2: drawPlan(MODEL, "main", "ELECTRICAL SHEET E-2", [[8.0, 4.5, 1.1, 3.2]], 0.15),
    pu1: drawPlan(MODEL, "upper", "UPPER FLOOR PLAN", [[2.4, 2.4, 1.1, 3.2]]),
    pb1: drawPlan(MODEL, "base", "BASEMENT PLAN", []),
  };
  const plan = (map_id, name, floor_id, refs = 2) => ({ map_id, name, floor_id, refs, corners_m: CORNERS(...EXT), image_sig: `sig_${map_id}`, place_sig: `place_${map_id}` });
  const PLANS = [plan("pm1", "Main floor", "main"), plan("pm2", "Electrical E-2", "main", 0), plan("pu1", "Upper floor", "upper"), plan("pb1", "Basement", "base")];
  const stair = (id, map_id, floor_id, x, y, match, extra = {}, geom = {}) => ({ id, kind: "stairs", map_id, floor_id, state: "queued", verdict: null, box_px: [120, 120, 240, 400], frame: [1036, 812], reads: ["whole", "crop"],
    seen_on: [{ map_id, x_m: x, y_m: y }], piece_id: null, geom: { x_m: x, y_m: y, rotation: 0, width_m: 1.1, depth_m: 3.2, shape: "straight", says: "up", sure_up: false, ...geom },
    match: { target: null, distance_m: null, relation: "new", near: [], near_names: [], held: null, target_snap: null, ...match }, ...extra });
  const snapDen = { label: "Den stairs", x_m: 1.2, y_m: 8.1 };
  const session = { id: "ps_1", rev: 7, status: "done", error: null, started_at: 0, finished_at: 0, spent_s: 250, budget_s: 480, reads: 14, skipped: 0, frame: "probed", errors: {},
    plans: PLANS.map(p => ({ map_id: p.map_id, name: p.name, floor_id: p.floor_id, read: true, answered: true })),
    suggestions: {
      a: stair("a", "pm1", "main", 2.5, 5.05, {}, {}, { rotation: 90 }),
      r: { id: "r", kind: "railing", of_stair: "a", map_id: "pm1", floor_id: "main", state: "queued", verdict: null, box_px: [120, 120, 240, 400], frame: [1036, 812], reads: ["crop"], seen_on: [{ map_id: "pm1", x_m: 2.5, y_m: 5.05 }], piece_id: null,
           geom: { stair: "a", side: null, x_m: 2.5, y_m: 5.05 }, match: { target: null, distance_m: null, relation: "new", near: [], held: null, target_snap: null, have: null } },
      b: stair("b", "pm1", "main", 2.6, 8.1, { relation: "correction", target: "fur_0000bb01", distance_m: 1.4, hand: true, target_snap: snapDen }),
      c: stair("c", "pm1", "main", 9.6, 8.25, { relation: "stacked", target: "fur_0000bb02", distance_m: 0.15, target_snap: { label: "Stairs (from the plan)", x_m: 9.6, y_m: 8.1 } }),
      d: stair("d", "pm1", "main", 8.0, 3.0, { others: [{ map_id: "pm2", distance_m: 1.5 }] }),
      e: stair("e", "pm2", "main", 8.0, 4.5, { others: [{ map_id: "pm1", distance_m: 1.5 }] }),
      u: stair("u", "pu1", "upper", 2.4, 2.4, {}),
      dup: stair("dup", "pm1", "main", 1.3, 8.1, { relation: "duplicate", target: "fur_0000bb01", distance_m: 0.1 }, { state: "duplicate" }),
    } };
  // plans=lights: a session of lights alone, against the fixture's own placed lights.
  if (lightsOnly) {
    const placed = Object.entries(MODEL.light_positions_m || {}).filter(([e, r]) => e.startsWith("light.") && r.floor_id === "main");
    const light = (id, x, y, match, extra = {}) => ({ id, kind: "light", map_id: "pm2", floor_id: "main", state: "queued", verdict: null, box_px: [300, 300, 330, 330], frame: [1036, 812], reads: ["tile", "crop"],
      seen_on: [{ map_id: "pm2", x_m: x, y_m: y }], piece_id: null, geom: { x_m: x, y_m: y, symbol: "pot" }, match: { target: null, distance_m: null, relation: "unmatched", near: [], held: null, target_snap: null, ...match }, ...extra });
    const on = ([eid, r], over = {}) => ({ relation: "correction", target: eid, distance_m: 0.2, want_kind: "pot", now_kind: "fixture", label: r.label || eid, group: false, target_snap: { x_m: r.x_m, y_m: r.y_m, floor_id: "main", stored_kind: null }, ...over });
    const at = (i) => placed[i % Math.max(1, placed.length)];
    session.suggestions = {
      l1: light("l1", at(0)[1].x_m + 0.2, at(0)[1].y_m, on(at(0))),
      l2: light("l2", at(1)[1].x_m + 0.3, at(1)[1].y_m, on(at(1), { group: true, label: "Pots Main North", now_kind: null })),
      l3: light("l3", 3.4, 2.6, {}, { state: "unmatched" }),
      l4: light("l4", 5.2, 7.4, {}, { state: "unmatched" }),
      ld: light("ld", at(0)[1].x_m, at(0)[1].y_m, { relation: "duplicate", target: at(0)[0] }, { state: "duplicate" }),
    };
    session.plans.forEach(p => { p.kinds = ["stairs", "light"]; });
    session.lights_asked = true; session.tiles = 9;
    IMG.pm2 = drawPlan(MODEL, "main", "ELECTRICAL SHEET E-2", [], 0, Object.values(session.suggestions).map(s => [s.geom.x_m, s.geom.y_m]));
  }
  const sugs = session.suggestions;
  const calls = [];
  const record = { stairs: { right: 7, of: 9 } };
  const answers = {
    plan_ai_plans: () => ({ plans: PLANS, ai: { ready: true, name: "Mac vision", local: true }, kinds: ["stairs", "railing"], running: null, latest: "ps_1", budget_s: 480, start_blocked: null }),
    plan_ai_status: () => ({ session, running: null, undo: null, record }),
    maps_image_urls: () => ({ image_urls: IMG }),
    plan_ai_rejects_get: () => ({ rejects: [] }),
    plan_ai_reject_forget: () => ({ ok: true }),
    plan_ai_verdict: (m) => {
      const s = sugs[m.sug_id];
      if (m.v === "back") { s.state = "queued"; s.verdict = null; } else { s.state = m.v; s.verdict = { v: m.v, why: m.why || null }; }
      const changed = [];
      if (s.kind === "stairs" && sugs.r && sugs.r.of_stair === s.id) {
        if (m.v === "failure") { sugs.r.state = "settled"; sugs.r.verdict = { v: "settled", stair: s.id }; changed.push(sugs.r); }
        if (m.v === "back" && sugs.r.state === "settled") { sugs.r.state = "queued"; sugs.r.verdict = null; changed.push(sugs.r); }
      }
      session.rev++;
      return { rev: session.rev, suggestion: s, changed, record };
    },
    plan_ai_commit: (m) => {
      const piece_ids = {}, out = {};
      let n = 0;
      for (const it of m.items) {
        const s = sugs[it.sug_id];
        if (s.kind === "light") {
          const eid = s.match.target;
          FILE.lights = FILE.lights || {};
          FILE.lights[eid] = { ...(FILE.lights[eid] || {}), kind: s.match.want_kind };
          piece_ids[it.sug_id] = eid; s.state = "committed_correction"; s.piece_id = eid;
        } else if (it.v === "new" && s.kind === "stairs") {
          const id = `fur_cafe00${(++n).toString(16).padStart(2, "0")}`;
          FILE.pieces[id] = { ...it.final, id, plan_ai: { session: "ps_1", batch: "pb_1", kind: "stairs" } };
          piece_ids[it.sug_id] = id; s.state = "committed_new"; s.piece_id = id;
        } else if (s.kind === "stairs") {
          const id = it.target || s.match.target;
          FILE.pieces[id] = { ...FILE.pieces[id], x_m: it.final.x_m, y_m: it.final.y_m };
          piece_ids[it.sug_id] = id; s.state = "committed_correction"; s.piece_id = id;
        } else { s.state = "committed_new"; }
        out[it.sug_id] = s;
      }
      session.rev++;
      return { ok: true, rev: session.rev, batch: "pb_1", piece_ids, suggestions: out, undo: { id: "pb_1", items: m.items.length, puts_back: false }, data: JSON.parse(JSON.stringify(FILE)) };
    },
    plan_ai_undo: () => ({ ok: true, undone: 0, of: 0, skipped: [], undo: null, data: JSON.parse(JSON.stringify(FILE)) }),
  };
  const callWS = async (m) => {
    const type = String(m.type || "").replace("padspan_ha/", "");
    calls.push({ ...m, type });
    const a = answers[type];
    if (!a) throw new Error(`No fake for ${type}`);
    return a(m);
  };
  return { settings: { ai_plans_enabled: true, atlas_3d_ai_task_entity: "ai_task.vision" }, callWS, calls, session,
    openAtlasRoom: (floor, room) => { calls.push({ type: "open_atlas", floor, room }); } };
}
